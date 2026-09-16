// QA: the SECURITY amenity is present on the post-ad + edit-listing forms, is
// saved, and renders on the listing detail page (instead of defaulting to
// "No Security" because it was never collected).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const ownerEmail = 'sec_' + stamp + '@example.com';
const password = 'TestPass123';

async function seed(role, email, phone) {
  const hash = await bcrypt.hash(password, 10);
  const r = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    'VALUES ($1,$2,$3,$4,$5,TRUE,$6) RETURNING id',
    ['QA ' + role, email, phone, hash, role, v4()]
  );
  return r.rows[0].id;
}

async function loginUI(page, email) {
  await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
  await page.fill('#loginIdentifier', email);
  await page.fill('#loginPassword', password);
  await page.click('#loginSubmitBtn');
  await page.waitForFunction(
    () => ['/home-seeker', '/home-agent', '/dashboard', '/admin'].some(p => location.pathname.startsWith(p)),
    null, { timeout: 15000 });
}

async function seedListing(ownerId, security) {
  const l = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price,
        price_per_head, base_price_per_head, location_area, nearest_landmark, status, poster_type,
        location_lat, location_lng)
     VALUES ($1,'QA Security Room','desc',1,900,900,900,900,'Testville','Test Landmark','active','owner',7.34,-2.33)
     RETURNING id, uuid`, [ownerId]);
  for (let i = 0; i < 2; i++) {
    await db.query('INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES ($1,$2,$3,$4)',
      [l.rows[0].id, '/images/placeholder.jpg', i === 0, i]);
  }
  await db.query(
    `INSERT INTO amenities (listing_id, water, electricity, security, furnishing, bathroom)
     VALUES ($1,'constant','prepaid',$2,'unfurnished','shared')`, [l.rows[0].id, security]);
  return l.rows[0];
}

async function loginAPI(identifier) {
  const r = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  });
  return r.json();
}

export default async function run(page) {
  const out = {};
  const ownerId = await seed('owner', ownerEmail, '066' + String(stamp).slice(-7));
  // Seed MULTIPLE security kinds to prove the multi-choice storage round-trips.
  const listing = await seedListing(ownerId, 'gated,cctv');

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginUI(page, ownerEmail);

    // ── Post-ad page: the Security chips must exist with the right values ──
    await page.goto('http://localhost:3000/post-ad', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    out.postAd_securityChipValues = await page.$$eval('#edSecurityGroup input', els => els.map(e => e.value));
    out.postAd_securityAllUncheckedByDefault =
      (await page.$$eval('#edSecurityGroup input', els => els.every(e => !e.checked)));

    // ── Edit page: Security chips exist and are pre-filled from the saved amenity ──
    await page.goto('http://localhost:3000/edit-listing?id=' + listing.uuid, { waitUntil: 'load' });
    out.editPageLoaded = await page.waitForSelector('#editContent', { state: 'visible', timeout: 10000 })
      .then(() => true).catch(() => false);
    out.edit_securityChipCount = (await page.$$('#edSecurityGroup input')).length;
    out.edit_checkedSecurity = await page.$$eval('#edSecurityGroup input:checked', els => els.map(e => e.value));
    await page.screenshot({ path: 'security-edit.png', fullPage: true });

    // ── Detail page: it must show BOTH saved kinds, NOT "No Security" ──
    await page.goto('http://localhost:3000/listing?id=' + listing.uuid, { waitUntil: 'load' });
    await page.waitForSelector('#amenitiesGrid', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(800);
    const amenityText = await page.$eval('#amenitiesGrid', el => el.textContent);
    out.detail_showsGated = /Gated/.test(amenityText);
    out.detail_showsCctv = /CCTV/.test(amenityText);
    out.detail_showsNoSecurity = /No Security/.test(amenityText);
    await page.screenshot({ path: 'security-detail.png', fullPage: false });

    // ── Edit page: tick a THIRD kind and save; the stored value must grow ──
    await page.goto('http://localhost:3000/edit-listing?id=' + listing.uuid, { waitUntil: 'load' });
    await page.waitForSelector('#editContent', { state: 'visible', timeout: 10000 });
    // The checkbox input is visually hidden (the chip span is the click target),
    // so click the visible label rather than the input itself.
    await page.click('#edSecurityGroup label:has(input[value="guard"]) span');
    await page.click('#editSubmitBtn');
    await page.waitForTimeout(2500);
    const afterSave = await db.query('SELECT security FROM amenities WHERE listing_id=$1', [listing.id]);
    out.db_securityAfterAddingGuard = afterSave.rows[0].security;

    // ── Server normalisation: array input, junk tokens, dedupe, empty -> 'none' ──
    const tok = await loginAPI(ownerEmail);
    const auth = { Authorization: 'Bearer ' + tok.token };
    // Direct API edit with a bad+junk set must keep only known tokens, deduped.
    const fd = new FormData();
    fd.append('security', 'cctv');
    fd.append('security', 'cctv');
    fd.append('security', 'bogus');
    fd.append('security', 'fenced');
    const put1 = await fetch('http://localhost:3000/api/listings/' + listing.uuid, { method: 'PUT', headers: auth, body: fd });
    out.api_put1_status = put1.status;
    out.api_put1_body = await put1.text();
    const norm = await db.query('SELECT security FROM amenities WHERE listing_id=$1', [listing.id]);
    out.db_securityNormalized = norm.rows[0].security;
    // Empty selection (explicit 'none') clears security.
    const fd2 = new FormData();
    fd2.append('security', 'none');
    const put2 = await fetch('http://localhost:3000/api/listings/' + listing.uuid, { method: 'PUT', headers: auth, body: fd2 });
    out.api_put2_status = put2.status;
    out.api_put2_body = await put2.text();
    const cleared = await db.query('SELECT security FROM amenities WHERE listing_id=$1', [listing.id]);
    out.db_securityCleared = cleared.rows[0].security;

    return out;
  } finally {
    await db.query('DELETE FROM listings WHERE id=$1', [listing.id]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
}
