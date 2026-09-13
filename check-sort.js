const { Client } = require('pg');
// Session mode (port 5432) — matches .env; see src/utils/db.js for the rationale.
const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres.iqzargqlttnrorriwsea:FunstarDB100@aws-0-eu-west-2.pooler.supabase.com:5432/postgres' });
(async () => {
  await c.connect();
  const r = await c.query("SELECT title, listed_price, price_per_head, occupancy_type FROM listings WHERE status='active' ORDER BY price_per_head ASC");
  for (const x of r.rows) console.log(`${x.title} | listed=${x.listed_price} | perHead=${x.price_per_head} | occ=${x.occupancy_type}`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
