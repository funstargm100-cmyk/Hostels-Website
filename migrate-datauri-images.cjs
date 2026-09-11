// One-off migration: replace inline base64 data-URI images in listing_images
// with properly stored files (Supabase Storage, falling back to local disk).
require('dotenv').config();
const { Pool } = require('pg');
const { storeImage } = require('./src/utils/imageStorage');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const { rows } = await pool.query("SELECT id, listing_id, image_path FROM listing_images WHERE image_path LIKE 'data:%'");
  console.log(`Found ${rows.length} data-URI image(s) to migrate`);
  for (const row of rows) {
    try {
      const m = /^data:([^;,]+);base64,(.+)$/.exec(row.image_path);
      if (!m) { console.log(`row ${row.id}: unrecognised format, skipped`); continue; }
      const buf = Buffer.from(m[2], 'base64');
      const stored = await storeImage(buf, `listing-${row.listing_id}-row-${row.id}.jpg`);
      await pool.query('UPDATE listing_images SET image_path=$1 WHERE id=$2', [stored, row.id]);
      console.log(`row ${row.id} (listing ${row.listing_id}): ${Math.round(buf.length / 1024)} KB -> ${stored.slice(0, 80)}`);
    } catch (e) {
      console.log(`row ${row.id}: FAILED - ${e.message.slice(0, 150)}`);
    }
  }
  const after = await pool.query("SELECT count(*)::int AS n FROM listing_images WHERE image_path LIKE 'data:%'");
  console.log('Remaining data-URI rows:', after.rows[0].n);
  await pool.end();
})().catch(e => { console.log('ERR', e.message.slice(0, 300)); process.exit(1); });
