// QA: photo reordering on the POST-AD page (drag & drop + tap-to-swap fallback).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'pad_' + stamp + '@example.com';
const password = 'TestPass123';

// 1x1 PNGs with distinct pixel colours so we can tell tiles apart.
const colors = {
  red: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  green: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  blue: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const o = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('PostAd Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '077' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = o.rows[0].id;

  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => location.pathname.startsWith('/home-agent'), null, { timeout: 15000 });

    await page.goto('http://localhost:3000/post-ad', { waitUntil: 'load' });
    await page.waitForTimeout(500);

    // Upload cover (step 1 requires it)
    const redPng = Buffer.from(colors.red, 'base64');
    await page.setInputFiles('#coverInput', { name: 'cover.png', mimeType: 'image/png', buffer: redPng });
    await page.waitForTimeout(300);
    // Upload 3 distinct photos (photos are STEP 1, alongside the cover)
    const pngs = Object.entries(colors).map(([n, b64]) => ({
      name: n + '.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64')
    }));
    await page.setInputFiles('#fileInput', pngs);
    await page.waitForTimeout(500);

    out.layout = await page.evaluate(() => {
      const pv = document.getElementById('photoPreview');
      const t = pv?.querySelector('[data-index="0"]');
      const r = pv?.getBoundingClientRect();
      const cs = pv ? getComputedStyle(pv) : null;
      const tp = t?.getBoundingClientRect();
      const panel = pv?.closest('.wizard-panel');
      return {
        pvExists: !!pv,
        pvRect: r && { w: r.width, h: r.height },
        pvDisplay: cs?.display, pvChildren: pv?.children.length,
        tileRect: tp && { w: tp.width, h: tp.height },
        panelActive: panel?.classList.contains('active'),
        panelDisplay: panel ? getComputedStyle(panel).display : null,
        pvCSS: pv ? (pv.getAttribute('style') || '') : null,
      };
    });


    out.beforeOrder = await page.$$eval('#photoPreview [data-index]',
      els => els.map(e => Number(e.dataset.index)));
    out.hasTiles = out.beforeOrder.length === 3;

    // What sits at the centre of tile 0? If an overlay covers it, clicks die.
    out.coverProbe = await page.evaluate(() => {
      const t = document.querySelector('#photoPreview [data-index="0"]');
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        hitTag: hit?.tagName, hitDesc: hit ? (hit.id || hit.className || hit.parentElement?.className) : null,
        isTileItself: hit === t || t.contains(hit)
      };
    });

    // Try a raw dispatch click too, to separate 'overlay blocks it' from 'JS broken'.
    await page.evaluate(() => {
      const t = document.querySelector('#photoPreview [data-index="0"]');
      t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    await page.waitForTimeout(300);
    out.tapSelectAppliedAfterDispatch = await page.$eval('#photoPreview [data-index="0"]',
      el => el.classList.contains('tap-selected')).catch(() => null);
    // clear it again
    await page.evaluate(() => { tapIndex = null; document.querySelectorAll('#photoPreview [data-index]').forEach(t => t.classList.remove('tap-selected')); });

    // ── Drag test: HTML5 drag via Playwright mouse is unreliable headless;
    //    instead call the exposed logic the same way the events do. ──
    out.movePhotoExists = await page.evaluate(() => typeof window.movePhoto === 'function');

    // Simulate a real drag sequence: dispatch dragstart on tile 0, drop on tile 2.
    await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('#photoPreview [data-index]')];
      const mk = (type) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
      tiles[0].dispatchEvent(mk('dragstart'));
      tiles[2].dispatchEvent(mk('dragover'));
      tiles[2].dispatchEvent(mk('drop'));
      tiles[0].dispatchEvent(mk('dragend'));
    });
    await page.waitForTimeout(300);

    out.orderAfterDrag = await page.$$eval('#photoPreview [data-index]',
      els => els.map(e => Number(e.dataset.index)));

    // Which src is now in position 0? (dragged red was index 0, moved to 2)
    const srcs = await page.$$eval('#photoPreview [data-index] img', els => els.map(e => e.src));
    out.firstSrcIsGreenAfterDrag = srcs[0].length > 0; // existence only; colour not decodable from src

    // Identify each tile by its 1px PNG colour (survives re-renders + new blob URLs)
    const readColors = () => page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#photoPreview [data-index]').forEach(t => {
        const img = t.querySelector('img');
        const c = document.createElement('canvas'); c.width = c.height = 1;
        c.getContext('2d').drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = c.getContext('2d').getImageData(0, 0, 1, 1).data;
        out.push(r > 200 && g < 100 ? 'red' : g > 150 && r < 100 ? 'green' : b > 150 ? 'blue' : `${r},${g},${b}`);
      });
      return out;
    });
    out.colorsBefore = await readColors();

    // ── REAL HTML5 drag: mouse down on tile 0, drag onto tile 2 ──
    const t0 = await page.$('#photoPreview [data-index="0"]');
    const t2 = await page.$('#photoPreview [data-index="2"]');
    const b0 = await t0.boundingBox(), b2 = await t2.boundingBox();
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 10 });
    await page.waitForTimeout(200);
    out.dragOverClass = await page.$eval('#photoPreview [data-index="2"]', el => el.style.outline);
    await page.mouse.up();
    await page.waitForTimeout(300);
    out.colorsAfterRealDrag = await readColors();
    out.dragIndexAfter = await page.evaluate(() => { try { return dragIndex; } catch { return 'unreadable'; } });
    try {
      await page.click('#photoPreview [data-index="0"]', { timeout: 5000 });
      await page.waitForTimeout(300);
      out.tapSelectApplied = await page.$eval('#photoPreview [data-index="0"]',
        el => el.classList.contains('tap-selected')).catch(() => null);
      await page.click('#photoPreview [data-index="2"]', { timeout: 5000 });
      await page.waitForTimeout(300);
      out.toastShown = await page.evaluate(() => !!document.querySelector('.toast, [class*=toast]'));
      out.orderAfterTapSwap = await page.$$eval('#photoPreview [data-index]',
        els => els.map(e => Number(e.dataset.index)));
      out.colorsAfterTap = await readColors();

      // ── Touch path (mobile): tap via touchscreen → pointer events ──
      const c0 = await page.$('#photoPreview [data-index="0"]');
      const b0 = await c0.boundingBox();
      await page.touchscreen.tap(b0.x + b0.width / 2, b0.y + b0.height / 2);
      await page.waitForTimeout(400);
      out.touchSelect = await page.$eval('#photoPreview [data-index="0"]',
        el => el.classList.contains('tap-selected')).catch(() => null);
      const c2 = await page.$('#photoPreview [data-index="2"]');
      const b2 = await c2.boundingBox();
      await page.touchscreen.tap(b2.x + b2.width / 2, b2.y + b2.height / 2);
      await page.waitForTimeout(400);
      out.colorsAfterTouchSwap = await readColors();
    } catch (err) {
      out.tapClickError = String(err).slice(0, 300);
      // What's covering the tile right now?
      out.coverProbe2 = await page.evaluate(() => {
        const t = document.querySelector('#photoPreview [data-index="0"]');
        if (!t) return 'no tile';
        const r = t.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { hit: hit?.tagName, cls: hit?.className, same: hit === t || t.contains(hit) };
      }).catch(() => null);
    }

    return out;
  } finally {
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
}
