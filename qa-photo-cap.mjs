// QA: the 10-photos-per-listing cap is enforced (server rejects 11, and the UI
// limits how many new files can be added).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'cap_' + stamp + '@example.com';
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const ownerIns = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Cap Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '044' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = ownerIns.rows[0].id;

  const mk = async (title) => {
    const l = await db.query(
      `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, status)
       VALUES ($1,$2,'d',1,900,900,900,'T','active') RETURNING id, uuid`,
      [ownerId, title]
    );
    return { id: l.rows[0].id, uuid: l.rows[0].uuid };
  };

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  const listing = await mk('Cap Room');
  // Seed NINE photos -> one slot left.
  for (let i = 0; i < 9; i++) {
    await db.query(
      'INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES ($1,$2,$3,$4)',
      [listing.id, 'data:image/png;base64,' + png.toString('base64'), i === 0, i]
    );
  }

  const pngPath = require('path').join(require('os').tmpdir(), 'qa-cap.png');
  require('fs').writeFileSync(pngPath, png);

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => location.pathname.startsWith('/home-agent'), null, { timeout: 15000 });

    await page.goto('http://localhost:3000/edit-listing?id=' + listing.uuid, { waitUntil: 'load' });
    await page.waitForSelector('#editContent', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);
    out.startCount = await page.$eval('#photoCount', el => el.textContent.trim());

    // Try to stage TWO new photos when only one slot remains.
    await page.setInputFiles('#edNewPhotos', [pngPath, pngPath]);
    await page.waitForTimeout(600);
    out.afterAdding2 = await page.$eval('#photoCount', el => el.textContent.trim());
    out.newTilesAfterAdding2 = await page.$$eval('#newPhotos .photo-tile', els => els.length).catch(() => -1);
    out.photoErrorShown = await page.$eval('#photoError', el => el.style.display !== 'none' && el.textContent.trim()).catch(() => false);
    out.dropzoneDisabledAtMax = await page.$eval('#photoDropzone', el => el.style.pointerEvents === 'none');

    // Save: should stay at exactly 10 (one new added, second rejected).
    await page.click('#editSubmitBtn');
    await page.waitForTimeout(3000);
    const c = await db.query('SELECT COUNT(*)::int AS c FROM listing_images WHERE listing_id=$1', [listing.id]);
    out.dbCountAfterSave = c.rows[0].c;

    // Direct API abuse: try to push an 11th photo.
    const tok = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password })
    }).then(r => r.json());

    const fd = new FormData();
    fd.append('remove_image_ids', '[]');
    fd.append('title', 'Cap Room');
    fd.append('description', 'd');
    fd.append('original_price', '900');
    fd.append('occupancy_type', '1');
    fd.append('location_area', 'T');
    fd.append('images', new Blob([png], { type: 'image/png' }), 'extra.png');
    const abuse = await fetch('http://localhost:3000/api/listings/' + listing.uuid, {
      method: 'PUT', headers: { Authorization: 'Bearer ' + tok.token }, body: fd
    });
    out.abuseStatus = abuse.status;
    out.abuseBody = await abuse.json().catch(() => ({}));
    const c2 = await db.query('SELECT COUNT(*)::int AS c FROM listing_images WHERE listing_id=$1', [listing.id]);
    out.dbCountAfterAbuse = c2.rows[0].c;

    return out;
  } finally {
    await db.query('DELETE FROM listings WHERE id=$1', [listing.id]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
}
