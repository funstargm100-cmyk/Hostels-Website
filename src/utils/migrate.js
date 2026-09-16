// Automatic schema migrations, run once at boot.
//
// The project ships a single `schema.sql`, applied by hand on a fresh database.
// Columns added later would otherwise be missing in an already-deployed database
// (e.g. "column base_price_per_head does not exist"). This module keeps a deployed
// database in step with the code without a manual step.
//
// Deployment is serverless (Vercel, see vercel.json): many short-lived instances
// can boot at once. Two safeguards make running here safe and cheap:
//
//   1. A `schema_migrations` ledger records every migration that has completed.
//      Completed migrations are skipped, so steady-state cold starts do almost no
//      work — they read the ledger and return.
//   2. A Postgres ADVISORY LOCK serialises the actual run. If two instances cold-
//      start together, one takes the lock and migrates; the other waits, then sees
//      the ledger filled and does nothing. No double-run, no race.
//
// Statements are additive and idempotent (ADD COLUMN IF NOT EXISTS, CREATE ... IF
// NOT EXISTS, and backfills that only touch rows still missing a value), so even
// an interrupted run is safe to repeat.
const db = require('./db');

// Stable key for the advisory lock — Postgres takes a single 64-bit integer.
const MIGRATION_LOCK_KEY = 8274519001234;

// Collapse runs of whitespace so a multi-line statement logs on a single line.
const oneLine = (s) => String(s).split(/\s+/).join(' ').slice(0, 160);

// Ordered, additive-only migrations. Each has a unique `id` (recorded in the
// ledger) and its SQL. Keep this list in step with the "Migration:" section at the
// bottom of schema.sql, and NEVER edit or reuse an existing id.
const MIGRATIONS = [
  { id: 'listings_full_address', sql: `ALTER TABLE listings ADD COLUMN IF NOT EXISTS full_address TEXT` },

  // Seeker workplace/school location (used to find rooms nearby).
  { id: 'users_base_location', sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS base_location TEXT` },
  { id: 'users_base_lat', sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS base_lat DOUBLE PRECISION` },
  { id: 'users_base_lng', sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS base_lng DOUBLE PRECISION` },

  // One credential may own BOTH a seeker and an agent/owner account; rows that
  // share a credential are linked by account_group. Uniqueness moves from the
  // single column to (credential, role).
  { id: 'users_account_group', sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_group UUID` },
  { id: 'users_drop_email_key', sql: `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key` },
  { id: 'users_drop_phone_key', sql: `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key` },
  { id: 'users_email_role_key', sql: `CREATE UNIQUE INDEX IF NOT EXISTS users_email_role_key ON users (LOWER(email), role) WHERE email IS NOT NULL` },
  { id: 'users_phone_role_key', sql: `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_role_key ON users (phone, role) WHERE phone IS NOT NULL` },
  // Every pre-existing account becomes its own group.
  { id: 'users_account_group_backfill', sql: `UPDATE users SET account_group = uuid_generate_v4() WHERE account_group IS NULL` },

  // Owners can also be agents and vice-versa without re-signup.
  { id: 'users_wallet_balance', sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12,2) DEFAULT 0` },

  // Poster follows — seekers follow owners/agents to hear about new rooms.
  { id: 'follows_table', sql: `CREATE TABLE IF NOT EXISTS follows (
     id SERIAL PRIMARY KEY,
     follower_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     poster_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE (follower_id, poster_id)
   )` },
  { id: 'follows_poster_idx', sql: `CREATE INDEX IF NOT EXISTS follows_poster_idx ON follows (poster_id)` },

  // Poster type + commission + platform fee on listings.
  { id: 'listings_poster_type', sql: `ALTER TABLE listings ADD COLUMN IF NOT EXISTS poster_type VARCHAR(10) DEFAULT 'owner'` },
  { id: 'listings_commission_type', sql: `ALTER TABLE listings ADD COLUMN IF NOT EXISTS commission_type VARCHAR(10)` },
  { id: 'listings_commission_value', sql: `ALTER TABLE listings ADD COLUMN IF NOT EXISTS commission_value NUMERIC(12,2)` },
  { id: 'listings_platform_fee_rate', sql: `ALTER TABLE listings ADD COLUMN IF NOT EXISTS platform_fee_rate NUMERIC(5,4)` },
  { id: 'listings_platform_fee', sql: `ALTER TABLE listings ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(12,2)` },

  // Gender preference on listings ('mixed' | 'male' | 'female'), then backfill.
  { id: 'listings_gender_preference', sql: `ALTER TABLE listings ADD COLUMN IF NOT EXISTS gender_preference VARCHAR(10) DEFAULT 'mixed'` },
  { id: 'listings_gender_preference_backfill', sql: `UPDATE listings SET gender_preference = 'mixed' WHERE gender_preference IS NULL` },

  // The poster's BASE price per head (before commission + platform fee), then
  // backfill by reversing the forward formula:
  //   owner: price_per_head = base × 1.07
  //   agent: price_per_head = base × 1.05 + commission_value × (1 + 0.05 × occ²)
  { id: 'listings_base_price_per_head', sql: `ALTER TABLE listings ADD COLUMN IF NOT EXISTS base_price_per_head NUMERIC(10,2)` },
  { id: 'listings_base_price_per_head_backfill', sql: `UPDATE listings SET base_price_per_head = CASE
       WHEN poster_type = 'agent' AND commission_value IS NOT NULL THEN
         GREATEST(ROUND((price_per_head - commission_value * (1 + 0.05 * occupancy_type * occupancy_type)) / 1.05, 2), 0.01)
       ELSE
         ROUND(price_per_head / 1.07, 2)
     END
     WHERE base_price_per_head IS NULL` },

  // Security becomes MULTI-CHOICE: a room may be e.g. Gated AND CCTV AND guarded.
  // Stored as a comma-separated list of tokens (or the single sentinel 'none'), so
  // we widen the column and drop the old single-value CHECK constraint. The new
  // CHECK accepts 'none' or a comma-separated subset of the allowed tokens — see
  // the regex in the constraint below. Existing single values already satisfy it.
  { id: 'amenities_security_widen',
    sql: `ALTER TABLE amenities ALTER COLUMN security TYPE VARCHAR(60)` },
  // Drop the old single-value constraint, then add the multi-choice one. Both are
  // in ONE multi-statement query so the migration is idempotent: even if a prior
  // attempt added the constraint but failed to record it, a retry drops it first.
  { id: 'amenities_security_multichoice_check',
    sql: `ALTER TABLE amenities DROP CONSTRAINT IF EXISTS amenities_security_check;
          ALTER TABLE amenities ADD CONSTRAINT amenities_security_check CHECK (
            security IS NULL OR security ~ '^(none|(fenced|gated|guard|cctv)(,(fenced|gated|guard|cctv))*)$'
          )` }
];

let hasRun = false; // per-process guard — a single instance boots once

// Apply every migration that has not yet been recorded. Never throws — a failure
// is logged and boot continues, so a transient DB hiccup cannot stop the server.
async function runMigrations() {
  if (hasRun) return;
  hasRun = true;

  const client = await db.connect().catch((err) => {
    console.error('MIGRATION SKIPPED — could not connect to the database:', err.message);
    return null;
  });
  if (!client) return;

  try {
    // Ensure the ledger exists, then consult/record it under the advisory lock.
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // Serialise the run across concurrent serverless instances. wait=true blocks
    // until the lock is free, so a racing cold start waits rather than skipping and
    // then runs the migrations itself.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const { rows } = await client.query('SELECT id FROM schema_migrations');
      const done = new Set(rows.map((r) => r.id));

      let applied = 0;
      for (const m of MIGRATIONS) {
        if (done.has(m.id)) continue;
        try {
          await client.query(m.sql);
          await client.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [m.id]);
          applied++;
        } catch (err) {
          // Log with the exact SQL and keep going — later migrations may still apply.
          console.error('MIGRATION FAILED:', m.id, '-', err.message, '\n  SQL:', oneLine(m.sql));
        }
      }
      console.log(`Schema migrations: ${MIGRATIONS.length} total, ${applied} applied now, ${MIGRATIONS.length - applied} already present.`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  } catch (err) {
    console.error('MIGRATION RUN FAILED:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
