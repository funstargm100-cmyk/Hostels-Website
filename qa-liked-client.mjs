// Verify the CLIENT paints the heart filled for an already-liked room on load.
// Writes are blocked in this env, so we sign in by injecting a real JWT into
// localStorage (exactly what the app does after login) and inspect the DOM.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const db = require('./src/utils/db.js');

const SECRET = process.env.SESSION_SECRET || 'hostel_secret';

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });

try {
  // Pick a real seeker that has favorites.
  const u = await db.query(
    `SELECT u.id, u.uuid, u.name, u.role FROM users u
     JOIN favorites f ON f.user_id = u.id GROUP BY u.id, u.uuid, u.name, u.role LIMIT 1`);
  const user = u.rows[0];
  const token = jwt.sign({ id: user.id, uuid: user.uuid, name: user.name, role: user.role }, SECRET, { expiresIn: '1h' });
  const saved = (await db.query(
    'SELECT (SELECT uuid FROM listings WHERE id=listing_id) as uuid FROM favorites WHERE user_id=$1', [user.id]))
    .rows.map(r => r.uuid);

  // Establish origin so localStorage sticks, then inject the session.
  await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, { token, user });

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const cards = await page.$$eval('#listingsGrid .card', (els) =>
    els.map(el => {
      const href = el.getAttribute('onclick') || '';
      const m = href.match(/id=([a-f0-9-]+)/i);
      const svg = el.querySelector('.fav-btn svg');
      const fill = svg ? getComputedStyle(svg).fill : null;
      const filled = !!fill && fill !== 'none' && fill !== 'rgba(0, 0, 0, 0)' && fill !== 'rgb(0, 0, 0)';
      return { uuid: m ? m[1] : null, filled, active: el.querySelector('.fav-btn')?.classList.contains('active') };
    }));

  const savedOnPage = cards.filter(c => saved.includes(c.uuid));
  const notSavedOnPage = cards.filter(c => c.uuid && !saved.includes(c.uuid));

  console.log('viewer:', user.id, 'saved uuids:', saved);
  console.log('cards rendered:', cards.length);
  console.log('SAVED cards on page -> all hearts filled?', savedOnPage.map(c => ({ uuid: c.uuid, filled: c.filled, active: c.active })));
  console.log('UNSAVED cards -> hearts empty?', notSavedOnPage.slice(0, 5).map(c => ({ uuid: c.uuid, filled: c.filled })));
  console.log('RESULT savedAllFilled:', savedOnPage.length > 0 && savedOnPage.every(c => c.filled),
    '| unsavedAllEmpty:', notSavedOnPage.every(c => !c.filled));

  await page.screenshot({ path: 'qa-liked-refresh.png', fullPage: false });
  console.log('screenshot: qa-liked-refresh.png');
} catch (e) {
  console.log('QA ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
