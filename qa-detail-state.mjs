// QA: listing DETAIL page — heart persists across refresh, and the Request
// button flips to "Request Sent" and stays that way after a reload.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const ownerEmail = 'det_owner_' + stamp + '@example.com';
const seekerEmail = 'det_seeker_' + stamp + '@example.com';
const password = 'TestPass123';
const title = 'Detail State Room ' + stamp;

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);

  const owner = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Det Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [ownerEmail, '095' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = owner.rows[0].id;

  const listing = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, status)
     VALUES ($1,$2,'QA detail state room',1,900,900,900,'Detailville','active') RETURNING id, uuid`,
    [ownerId, title]
  );
  const listingId = listing.rows[0].id;
  const listingUuid = listing.rows[0].uuid;

  const seeker = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Det Seeker',$1,$2,$3,'seeker',TRUE,$4) RETURNING id",
    [seekerEmail, '096' + String(stamp).slice(-7), hash, v4()]
  );
  const seekerId = seeker.rows[0].id;

  const readDetail = () => page.evaluate(() => {
    const fav = document.getElementById('favBtn');
    const favSvg = fav && fav.querySelector('svg');
    const fill = favSvg ? getComputedStyle(favSvg).fill : null;
    const reqLabel = document.getElementById('requestBtnLabel');
    const reqBtn = document.getElementById('requestBtn');
    return {
      heartFilled: !!fill && fill !== 'none' && fill !== 'rgba(0, 0, 0, 0)' && fill !== 'rgb(0, 0, 0)',
      favActive: fav ? fav.classList.contains('active') : null,
      requestLabel: reqLabel ? reqLabel.textContent.trim() : null,
      requestDisabled: reqBtn ? reqBtn.disabled : null,
    };
  });

  try {
    // Log in as the seeker.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.waitForSelector('#loginIdentifier', { timeout: 15000 });
    await page.fill('#loginIdentifier', seekerEmail);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });

    // ── Detail page load (nothing saved/requested yet).
    await page.goto('http://localhost:3000/listing?id=' + listingUuid, { waitUntil: 'load' });
    await page.waitForSelector('#detailContent', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    out.initial = await readDetail();

    // ── Save (like) on the detail page.
    await page.click('#favBtn');
    await page.waitForTimeout(800);
    out.afterLike = await readDetail();

    // ── REFRESH the detail page — the heart must stay filled.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#detailContent', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    out.afterLikeReload = await readDetail();

    // ── Send a request via the modal.
    await page.click('#requestBtn');
    await page.waitForSelector('#interestModal', { state: 'visible', timeout: 8000 });
    await page.fill('#intName', 'Det Seeker');
    await page.fill('#intPhone', '0200000');
    await page.click('#interestSubmitBtn');
    await page.waitForTimeout(1200);
    out.afterRequest = await readDetail();

    // Request really landed in the DB?
    const rq = await db.query('SELECT 1 FROM contact_requests WHERE seeker_id=$1 AND listing_id=$2', [seekerId, listingId]);
    out.requestInDb = rq.rows.length > 0;

    // ── REFRESH again — "Request Sent" must persist.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#detailContent', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(800);
    out.afterRequestReload = await readDetail();

    // ── API truth: the detail endpoint should flag both.
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const apiRes = await fetch('http://localhost:3000/api/listings/' + listingUuid, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const api = await apiRes.json();
    out.apiFavorited = api.listing?.favorited;
    out.apiHasRequested = api.listing?.has_requested;

    // ── Guest must get both false (no crash, no false-positive).
    const guest = await (await fetch('http://localhost:3000/api/listings/' + listingUuid)).json();
    out.guestFavorited = guest.listing?.favorited;
    out.guestHasRequested = guest.listing?.has_requested;

    await page.screenshot({ path: 'qa-detail-state.png' });
    out.screenshot = 'qa-detail-state.png';
  } finally {
    await db.query('DELETE FROM contact_requests WHERE seeker_id=$1', [seekerId]).catch(() => { });
    await db.query('DELETE FROM favorites WHERE user_id=$1', [seekerId]).catch(() => { });
    await db.query('DELETE FROM listings WHERE id=$1', [listingId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [seekerId]).catch(() => { });
  }
  return out;
}
