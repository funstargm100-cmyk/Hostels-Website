// One-off: set EVERY seeker's daily base to UENR (Sunyani). The base is no
// longer collected at signup nor editable in the profile — see
// src/utils/seekerBase.js. Safe to re-run (idempotent).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Client } = require('pg');
const { SEEKER_BASE } = require('./src/utils/seekerBase');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const res = await c.query(
    `UPDATE users SET base_location=$1, base_lat=$2, base_lng=$3
     WHERE role='seeker'
       AND (base_location IS DISTINCT FROM $1 OR base_lat IS DISTINCT FROM $2 OR base_lng IS DISTINCT FROM $3)
     RETURNING id, email`,
    [SEEKER_BASE.location, SEEKER_BASE.lat, SEEKER_BASE.lng]
  );
  console.log('Updated seekers:', res.rowCount);
  const check = await c.query("SELECT count(*) FROM users WHERE role='seeker'");
  console.log('Total seekers:', check.rows[0].count);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
