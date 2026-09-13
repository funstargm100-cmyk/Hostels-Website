const { Pool } = require('pg');

// DATABASE_URL uses Supavisor SESSION mode (pooler host, port 5432) — the right
// choice for this long-lived Express server. Session mode pins one server
// connection per client for the whole session, so it supports SET/RESET and
// cannot suffer the cross-client "poisoned session" leak that transaction mode
// (port 6543) allows.
//
// `max` is the app-side pool size. Keep it comfortably below the project's
// Supavisor pool size (Dashboard -> Database -> Connection pooling); Supabase's
// guidance is to leave the pooler headroom for PostgREST/auth. 10 is plenty for
// this app and well under any default pooler size.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  max: 10,
  idleTimeoutMillis: 30000
});

// Defense-in-depth. Session mode already prevents a poisoned session, but if this
// URL is ever switched back to the transaction pooler (port 6543), a stray
// `SET default_transaction_read_only = on` from any client on that shared backend
// would otherwise make every write fail with "cannot execute INSERT in a
// read-only transaction". Clearing the override once per fresh client neutralises
// that; on a healthy/session-mode connection it is a harmless no-op.
//
// The reset is stored as a promise on the client so the app's first query can
// await it — awaiting keeps the reset and that query from overlapping on the same
// connection (overlapping queries are deprecated in pg and emit a warning).
pool.on('connect', (client) => {
  client.__rwReady = client.query('RESET default_transaction_read_only').catch(() => {
    // Non-fatal: if the reset fails, the caller's own query surfaces the real error.
  });
});

// Run `sql` on a pooled client AFTER that client's read-write reset has settled.
// Used by every query the app makes, so a poisoned session can never make writes
// fail. Falls back to the plain pool when the client has no pending reset.
async function pooledQuery(text, params) {
  const client = await pool.connect();
  try {
    if (client.__rwReady) await client.__rwReady;
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// Route the app's direct queries (`db.query(...)`) through the same guard, so a
// poisoned session cannot make ANY write fail. `rawQuery` keeps the untouched
// Pool method; the app-facing `pool.query` is the guarded one.
pool.rawQuery = pool.query.bind(pool);
pool.query = (text, params) => pooledQuery(text, params);

// The [rows] helper, matching mysql2's destructuring pattern — the shape the
// rest of the app destructures (`const [rows] = await db.query2(...)`).
pool.query2 = async (text, params) => {
  const res = await pooledQuery(text, params);
  return [res.rows];
};

module.exports = pool;
