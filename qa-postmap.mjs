// QA: the post-ad map must OPEN zoomed-out over Sunyani (zoom ~6) then fly in.
// Drives the real wizard to step 5 (where initPostMap runs), so it exercises the
// production code path exactly.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'pm_' + stamp + '@example.com';
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const o = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('PostMap Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '088' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = o.rows[0].id;

  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.waitForSelector('#loginIdentifier', { timeout: 15000 });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });
    await page.goto('http://localhost:3000/post-ad', { waitUntil: 'load' });
    await page.waitForTimeout(800);

    // Step 1: cover + one more photo
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 40;
      const x = c.getContext('2d'); x.fillStyle = '#345'; x.fillRect(0, 0, 40, 40);
      return c.toDataURL('image/png');
    });
    const buf = Buffer.from(png.split(',')[1], 'base64');
    await page.setInputFiles('#coverInput', { name: 'cover.png', mimeType: 'image/png', buffer: buf });
    await page.setInputFiles('#fileInput', [{ name: 'p1.png', mimeType: 'image/png', buffer: buf }]);
    await page.waitForTimeout(500);
    await page.click('#nextBtn');

    // Step 2: title + description
    await page.fill('#adTitle', 'QA Sunyani Room');
    await page.fill('#adDescription', 'A QA room for testing the map fly-in behaviour.');
    await page.click('#nextBtn');

    // Step 3: occupancy + price
    await page.selectOption('#adOccupancy', { index: 1 }).catch(() => { });
    await page.fill('#adOriginalPrice', '1200');
    await page.click('#nextBtn');

    // Step 4: amenities (defaults pre-selected)
    await page.click('#nextBtn');

    // Step 5: the map panel is now active and initPostMap() has run
    // Sample the Leaflet ZOOM immediately (before css animations settle) by
    // reading the map's own zoom via the tile-zoom class on the container is not
    // available, so read the first tile's zoom as soon as any tile exists.
    await page.waitForFunction(() => {
      const el = document.getElementById('postMap');
      return el && el.querySelectorAll('img.leaflet-tile').length > 0;
    }, null, { timeout: 15000 }).catch(() => { });
    out.step = await page.evaluate(() => {
      const ps = document.querySelectorAll('.wizard-panel');
      return ps[4] ? ps[4].classList.contains('active') : null;
    });

    const sample = () => page.evaluate(() => {
      const el = document.getElementById('postMap');
      if (!el) return null;
      const tiles = [...el.querySelectorAll('img.leaflet-tile')].map(i => i.src);
      const zs = tiles.map(t => (t.match(/\/(\d+)\/\d+\/\d+\.png/) || [])[1]).filter(Boolean).map(Number);
      return { minZoom: zs.length ? Math.min(...zs) : null, maxZoom: zs.length ? Math.max(...zs) : null, tileCount: tiles.length };
    });

    const early = await sample();
    await page.waitForTimeout(1000);
    const mid = await sample();
    await page.waitForTimeout(3000);
    const late = await sample();
    out.early = early; out.mid = mid; out.late = late;
    // The opening view is the LOWEST zoom seen; the landing is the highest.
    const allZs = [early, mid, late].flatMap(s => (s && s.minZoom != null) ? [s.minZoom, s.maxZoom] : []);
    out.lowestZoomSeen = allZs.length ? Math.min(...allZs) : null;
    out.zoomedOutToStart = !!(out.lowestZoomSeen !== null && out.lowestZoomSeen <= 7);
    out.flewIn = !!(late && late.maxZoom >= 10);
  } finally {
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
  return out;
}
