require('dotenv').config();
const db = require('./src/utils/db');

(async () => {
  await db.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS base_location TEXT,
      ADD COLUMN IF NOT EXISTS base_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS base_lng DOUBLE PRECISION
  `);
  console.log('users base_location columns OK');
  process.exit(0);
})().catch(e => { console.error('MIGRATION ERROR:', e.message); process.exit(1); });
