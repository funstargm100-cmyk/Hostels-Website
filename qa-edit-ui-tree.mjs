// Describe the edit-listing photo UI structurally (text, not pixels).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'ui_' + stamp + '@example.com';
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const o = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('UI Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '099' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = o.rows[0].id;
  const l = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, status)
     VALUES ($1,'UI Room','d',1,900,900,900,'T','active') RETURNING id, uuid`, [ownerId]
  );
  const listingId = l.rows[0].id;
  const uuid = l.rows[0].uuid;

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  for (let i = 0; i < 3; i++) {
    await db.query(
      'INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES ($1,$2,$3,$4)',
      [listingId, 'data:image/png;base64,' + png.toString('base64'), i === 0, i]
    );
  }

  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => location.pathname.startsWith('/home-agent'), null, { timeout: 15000 });

    await page.goto('http://localhost:3000/edit-listing?id=' + uuid, { waitUntil: 'load' });
    await page.waitForSelector('#editContent', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(800);

    // Read the photo section like a screen reader would.
    const tree = await page.evaluate(() => {
      const photosHeading = [...document.querySelectorAll('#editContent h3')]
        .find(h => h.textContent.trim().startsWith('Photos'));
      const tiles = [...document.querySelectorAll('#currentPhotos .photo-tile')];
      return {
        heading: photosHeading ? photosHeading.textContent.trim() : null,
        hint: document.querySelector('#currentPhotos')?.previousElementSibling?.textContent.trim() || null,
        tiles: tiles.map(t => ({
          hasImage: !!t.querySelector('img'),
          hasRemoveBtn: !!t.querySelector('.photo-remove'),
          removeLabel: t.querySelector('.photo-remove')?.getAttribute('title') || null,
          primaryTag: t.querySelector('.photo-primary-tag')?.textContent.trim() || null
        })),
        dropzone: (() => {
          const d = document.getElementById('photoDropzone');
          return d ? { text: d.innerText.split('\n').map(s => s.trim()).filter(Boolean).join(' · '), hasFileInput: !!document.getElementById('edNewPhotos') } : null;
        })()
      };
    });
    out.photoSection = tree;

    // Confirm the "This is your listing." note is gone on the detail page.
    await page.goto('http://localhost:3000/listing?id=' + uuid, { waitUntil: 'load' });
    await page.waitForSelector('#ownerActions', { state: 'visible', timeout: 10000 }).catch(() => { });
    await page.waitForTimeout(800);
    out.detailOwnerText = await page.$eval('#ownerActions', el => el.innerText.split('\n').map(s => s.trim()).filter(Boolean).join(' | ')).catch(() => null);
    out.detailHasNoteText = (await page.content()).includes('This is your listing');

    return out;
  } finally {
    await db.query('DELETE FROM listings WHERE id=$1', [listingId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
}
