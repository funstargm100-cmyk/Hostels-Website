const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
require('dotenv').config();

const BUCKET = process.env.SUPABASE_BUCKET || 'listing-images';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const db = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await db.connect();
  const r = await db.query("SELECT id, listing_id, image_path FROM listing_images WHERE image_path LIKE 'https%'");
  let missing = 0;
  for (const row of r.rows) {
    const m = row.image_path.match(/\/object\/public\/[^/]+\/(.+)$/);
    if (!m) continue;
    const { error: dlErr } = await sb.storage.from(BUCKET).download(m[1]);
    if (dlErr) { missing++; console.log(`MISSING (listing ${row.listing_id}, img ${row.id}): ${m[1]}`); }
  }
  console.log(`checked ${r.rows.length} URLs, ${missing} missing`);
  await db.end();
})().catch(e => { console.error(e.message); process.exit(1); });
