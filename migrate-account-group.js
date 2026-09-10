require('dotenv').config();
const db = require('./src/utils/db');

// Allows ONE credential (email/phone) to own both a seeker and an agent/owner
// account. Rows that share a credential are linked by account_group. Because the
// original schema had single-column UNIQUE constraints on email and phone, those
// are replaced by per-(credential, role) unique indexes.
const statements = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_group UUID`,
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key`,
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_role_key ON users (LOWER(email), role) WHERE email IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_role_key ON users (phone, role) WHERE phone IS NOT NULL`,
  `UPDATE users SET account_group = uuid_generate_v4() WHERE account_group IS NULL`
];

(async () => {
  for (const sql of statements) {
    try {
      await db.query(sql);
      console.log('OK  ', sql.slice(0, 70));
    } catch (e) {
      console.error('FAIL', sql.slice(0, 70), '->', e.message);
    }
  }
  console.log('users account_group migration done');
  process.exit(0);
})().catch(e => { console.error('MIGRATION ERROR:', e.message); process.exit(1); });
