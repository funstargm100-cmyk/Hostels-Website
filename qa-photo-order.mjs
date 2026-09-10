// QA: photos can be rearranged in the edit page, the first becomes the cover,
// and both the edit page and the listing page label the cover.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'ord_' + stamp + '@example.com';
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const o = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Order Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '077' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = o.rows[0].id;
  const l = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, status)
     VALUES ($1,'Order Room','d',1,900,900,900,'T','active') RETURNING id, uuid`, [ownerId]
  );
  const listingId = l.rows[0].id;
  const uuid = l.rows[0].uuid;

  // Three DISTINCT photos so we can tell them apart by their pixel colour.
  const colors = { red: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', green: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', blue: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };
  const ids = {};
  let i = 0;
  for (const [name, b64] of Object.entries(colors)) {
    const r = await db.query(
      'INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
      [listingId, 'data:image/png;base64,' + b64, i === 0, i]
    );
    ids[name] = r.rows[0].id;
    i++;
  }

  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => location.pathname.startsWith('/home-agent'), null, { timeout: 15000 });

    // ── Edit page: cover label + order tags ──────────
    await page.goto('http://localhost:3000/edit-listing?id=' + uuid, { waitUntil: 'load' });
    await page.waitForSelector('#editContent', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(800);

    out.beforeOrder = await page.$$eval('#photoGrid .photo-tile', els => els.map(e => e.getAttribute('data-index')));
    out.beforeTileKeys = await page.$$eval('#photoGrid .photo-tile', els => els.map(e => e.getAttribute('data-key')));
    out.beforeCoverLabel = await page.$eval('#photoGrid .photo-tile[data-index="0"] .photo-primary-tag', el => el.textContent.trim()).catch(() => null);
    out.beforeOrderTags = await page.$$eval('#photoGrid .photo-order-tag', els => els.map(e => e.textContent.trim()));
    out.tilesDraggable = await page.$$eval('#photoGrid .photo-tile', els => els.every(e => e.getAttribute('draggable') === 'true'));
    out.dragHandles = await page.$$eval('#photoGrid .photo-drag-handle', els => els.length);

    // ── Rearrange via the tap-to-reorder interaction (real clicks) ──
    // Click tile 0 (select), then tile 2 (move it there) -> 3rd photo becomes 1st.
    await page.click('#photoGrid .photo-tile[data-index="0"]');
    await page.waitForTimeout(300);
    out.selectedAfterFirstTap = await page.$eval('#photoGrid .photo-tile.selected', el => el.getAttribute('data-index')).catch(() => null);
    await page.click('#photoGrid .photo-tile[data-index="2"]');
    await page.waitForTimeout(500);

    out.afterReorderCoverLabel = await page.$eval('#photoGrid .photo-tile[data-index="0"] .photo-primary-tag', el => el.textContent.trim()).catch(() => null);
    // Which listing_images id is now first in the DOM?
    out.firstTileKeyAfter = await page.$eval('#photoGrid .photo-tile[data-index="0"]', el => el.getAttribute('data-key')).catch(() => null);

    // Save.
    await page.click('#editSubmitBtn');
    await page.waitForTimeout(3000);

    // ── DB: ordering + single primary ────────────────
    const rows = await db.query(
      'SELECT id, sort_order, is_primary FROM listing_images WHERE listing_id=$1 ORDER BY sort_order', [listingId]);
    out.dbOrder = rows.rows.map(r => ({ id: r.id, order: r.sort_order, primary: r.is_primary }));
    out.dbPrimaryCount = rows.rows.filter(r => r.is_primary).length;
    out.dbFirstId = rows.rows[0].id;
    // We tapped tile 0 then tile 2, i.e. moved the FIRST photo to the END — so the
    // photo that was originally 2nd should now lead. Derive it from the loaded order.
    const secondOriginalKey = (out.beforeTileKeys || [])[1] || '';
    out.expectedFirstId = Number(secondOriginalKey.replace('i:', ''));
    out.reorderCorrect = out.dbFirstId === out.expectedFirstId;

    // ── Listing page: cover badge ────────────────────
    await page.goto('http://localhost:3000/listing?id=' + uuid, { waitUntil: 'load' });
    await page.waitForSelector('#gallery', { timeout: 10000 });
    await page.waitForTimeout(1200);
    out.detailCoverBadgeText = await page.$eval('#coverBadge', el => el.textContent.trim()).catch(() => null);
    out.detailCoverBadgeVisible = await page.isVisible('#coverBadge').catch(() => false);
    // Navigate to photo 2 -> badge should hide.
    await page.click('#galNext').catch(() => { });
    await page.waitForTimeout(500);
    out.detailCoverBadgeVisibleOn2nd = await page.isVisible('#coverBadge').catch(() => null);

    return out;
  } finally {
    await db.query('DELETE FROM listings WHERE id=$1', [listingId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
}
