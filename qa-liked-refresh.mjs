// QA: a liked room must show the heart FILLED after a page refresh.
// Regression guard for "Liked rooms don't show Liked button when page is refreshed".
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const seekerEmail = 'like_seeker_' + stamp + '@example.com';
const ownerEmail = 'like_owner_' + stamp + '@example.com';
const password = 'TestPass123';
const title = 'Liked Refresh Room ' + stamp;

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);

  // ── Seed an owner + one active listing, and a seeker.
  const owner = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Like Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [ownerEmail, '093' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = owner.rows[0].id;

  const listing = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, status)
     VALUES ($1,$2,'QA liked-refresh room',1,900,900,900,'Likerville','active') RETURNING id, uuid`,
    [ownerId, title]
  );
  const listingId = listing.rows[0].id;
  const listingUuid = listing.rows[0].uuid;

  const seeker = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Like Seeker',$1,$2,$3,'seeker',TRUE,$4) RETURNING id",
    [seekerEmail, '094' + String(stamp).slice(-7), hash, v4()]
  );
  const seekerId = seeker.rows[0].id;

  try {
    // ── 1) Guest API must report favorited=false (no crash without a token).
    const guest = await fetch('http://localhost:3000/api/listings?location=Likerville');
    const guestBody = await guest.json();
    const guestHit = guestBody.listings.find(l => l.uuid === listingUuid);
    out.guestFavorited = guestHit ? guestHit.favorited : 'listing-not-found';

    // ── 2) Log in as the seeker in the real UI.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.waitForSelector('#loginIdentifier', { timeout: 15000 });
    await page.fill('#loginIdentifier', seekerEmail);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });

    // ── 3) Browse to the listings page and favorite OUR room's card.
    await page.goto('http://localhost:3000/listings?location=Likerville', { waitUntil: 'load' });
    await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
    await page.waitForTimeout(1200);

    const cardSel = `#listingsGrid .card:has-text("${title}")`;
    // Heart starts EMPTY before any click.
    out.filledBeforeClick = await page.$eval(cardSel + ' .fav-btn svg',
      el => getComputedStyle(el).fill !== 'none' && getComputedStyle(el).fill !== 'rgba(0, 0, 0, 0)').catch(() => 'no-card');

    await page.click(cardSel + ' .fav-btn');
    await page.waitForTimeout(900);
    out.filledAfterClick = await page.$eval(cardSel + ' .fav-btn svg',
      el => getComputedStyle(el).fill !== 'none' && getComputedStyle(el).fill !== 'rgba(0, 0, 0, 0)').catch(() => 'no-card');
    out.activeClassAfterClick = await page.$eval(cardSel + ' .fav-btn',
      el => el.classList.contains('active')).catch(() => 'no-card');

    // Confirm it really saved server-side.
    const fav = await db.query('SELECT 1 FROM favorites WHERE user_id=$1 AND listing_id=$2', [seekerId, listingId]);
    out.savedInDb = fav.rows.length > 0;

    // ── 4) FULL PAGE REFRESH — the actual bug report.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
    await page.waitForTimeout(1200);

    out.filledAfterReload = await page.$eval(cardSel + ' .fav-btn svg',
      el => getComputedStyle(el).fill !== 'none' && getComputedStyle(el).fill !== 'rgba(0, 0, 0, 0)').catch(() => 'no-card');
    out.activeClassAfterReload = await page.$eval(cardSel + ' .fav-btn',
      el => el.classList.contains('active')).catch(() => 'no-card');

    // ── 5) The API itself should now flag it favorited for this viewer.
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const mine = await fetch('http://localhost:3000/api/listings?location=Likerville',
      { headers: { Authorization: `Bearer ${token}` } });
    const mineBody = await mine.json();
    const myHit = mineBody.listings.find(l => l.uuid === listingUuid);
    out.apiFavoritedForViewer = myHit ? myHit.favorited : 'listing-not-found';

    // ── 6) Un-favoriting on the reloaded page should toggle it OFF and persist.
    await page.click(cardSel + ' .fav-btn');
    await page.waitForTimeout(700);
    const gone = await db.query('SELECT 1 FROM favorites WHERE user_id=$1 AND listing_id=$2', [seekerId, listingId]);
    out.removedInDb = gone.rows.length === 0;
  } finally {
    await db.query('DELETE FROM favorites WHERE user_id=$1', [seekerId]).catch(() => { });
    await db.query('DELETE FROM listings WHERE id=$1', [listingId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [seekerId]).catch(() => { });
  }
  return out;
}
