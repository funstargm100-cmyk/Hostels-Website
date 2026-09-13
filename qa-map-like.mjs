// QA: a like made in grid view must show in the MAP view popup for the same room
// (and vice-versa), without a page reload.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const ownerEmail = 'map_owner_' + stamp + '@example.com';
const seekerEmail = 'map_seeker_' + stamp + '@example.com';
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);

  // Owner + 3 active listings, each with coordinates so they plot on the map.
  const owner = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Map Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [ownerEmail, '091' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = owner.rows[0].id;

  const ids = [];
  const coords = [[7.34, -2.33], [7.345, -2.335], [7.35, -2.34]];
  for (let i = 0; i < 3; i++) {
    const title = `Map QA Room ${i} ${stamp}`;
    const r = await db.query(
      `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, location_lat, location_lng, status)
       VALUES ($1,$2,'QA map view room',1,900,900,900,'Mapville',$3,$4,'active') RETURNING id, uuid`,
      [ownerId, title, coords[i][0], coords[i][1]]
    );
    ids.push({ id: r.rows[0].id, uuid: r.rows[0].uuid, title });
  }

  const seeker = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Map Seeker',$1,$2,$3,'seeker',TRUE,$4) RETURNING id",
    [seekerEmail, '092' + String(stamp).slice(-7), hash, v4()]
  );
  const seekerId = seeker.rows[0].id;

  const gridFilled = (uuid) => page.evaluate((u) => {
    const card = [...document.querySelectorAll('#listingsGrid .card')].find(el => (el.getAttribute('onclick') || '').includes(u));
    if (!card) return 'no-card';
    const s = card.querySelector('.fav-btn svg'); const f = s && getComputedStyle(s).fill;
    return !!f && f !== 'none' && f !== 'rgba(0, 0, 0, 0)' && f !== 'rgb(0, 0, 0)';
  }, uuid);

  try {
    await page.setViewportSize({ width: 1400, height: 950 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.waitForSelector('#loginIdentifier', { timeout: 15000 });
    await page.fill('#loginIdentifier', seekerEmail);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });

    // Browse near the seeded rooms so all three are in the result set.
    await page.goto('http://localhost:3000/listings?location=Mapville', { waitUntil: 'load' });
    await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
    await page.waitForTimeout(1500);

    const target = ids[0];
    out.gridBefore = await gridFilled(target.uuid);

    // Like it IN THE GRID.
    await page.evaluate((u) => {
      const card = [...document.querySelectorAll('#listingsGrid .card')].find(el => (el.getAttribute('onclick') || '').includes(u));
      card.querySelector('.fav-btn').click();
    }, target.uuid);
    await page.waitForTimeout(900);
    out.gridAfterLike = await gridFilled(target.uuid);

    // Confirm the shared array the MAP renders from now carries the flag.
    out.sharedArrayFlag = await page.evaluate((u) => {
      const arr = window.lastFetchedListings || [];
      const hit = arr.find(l => l.uuid === u);
      return hit ? hit.favorited : 'not-in-array';
    }, target.uuid);

    // Remember the target's title so the map test can find its marker.
    await page.evaluate((t) => { window.__mapTargetTitle = t; }, target.title);

    // Switch to MAP view.
    await page.click('#mapViewBtn');
    await page.waitForTimeout(3500);

    // Find the marker for our room and open its popup, then read the heart inside.
    out.mapPopup = await page.evaluate((u) => {
      const title = window.__mapTargetTitle;
      const mapObj = window.__mapInstance;
      let marker = null;
      if (mapObj && typeof mapObj.eachLayer === 'function') {
        mapObj.eachLayer(layer => {
          if (layer && typeof layer.eachLayer === 'function') {
            layer.eachLayer(mk => { if (mk && mk.__listingTitle === title) marker = mk; });
          }
        });
      }
      if (!marker) return 'marker-not-found';
      marker.openPopup();
      return 'opened';
    }, target.uuid);
    await page.waitForTimeout(1200);

    out.mapPopupFilled = await page.evaluate((u) => {
      // The open popup renders a card with a fav-btn carrying our uuid.
      const btn = document.querySelector(`.leaflet-popup .fav-btn[data-listing-uuid="${u}"]`);
      if (!btn) return 'no-popup-btn';
      const s = btn.querySelector('svg'); const f = s && getComputedStyle(s).fill;
      return { filled: !!f && f !== 'none' && f !== 'rgba(0, 0, 0, 0)' && f !== 'rgb(0, 0, 0)', active: btn.classList.contains('active') };
    }, target.uuid);

    await page.screenshot({ path: 'tmp-map-view.png' });
    out.screenshot = 'tmp-map-view.png';
  } finally {
    await db.query('DELETE FROM favorites WHERE user_id=$1', [seekerId]).catch(() => { });
    for (const it of ids) await db.query('DELETE FROM listings WHERE id=$1', [it.id]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [seekerId]).catch(() => { });
  }
  return out;
}
