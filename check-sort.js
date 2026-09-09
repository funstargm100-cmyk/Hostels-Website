const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres.iqzargqlttnrorriwsea:FunstarDB100@aws-0-eu-west-2.pooler.supabase.com:6543/postgres' });
(async () => {
  await c.connect();
  const r = await c.query("SELECT title, listed_price, price_per_head, occupancy_type FROM listings WHERE status='active' ORDER BY price_per_head ASC");
  for (const x of r.rows) console.log(`${x.title} | listed=${x.listed_price} | perHead=${x.price_per_head} | occ=${x.occupancy_type}`);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
