// QA: an ADMIN opens the listing DETAIL page for a room they do NOT own — an
// ACTIVE one and a PENDING one — and must be able to edit both. This covers:
//   - the detail page shows owner/management actions for an admin
//   - GET  /api/listings/:uuid/edit-data returns a non-owned listing to an admin
//   - PUT  /api/listings/:uuid saves an admin's edit to someone else's listing
//   - the edit page's edit button carries a `from` so an admin returns to it
//   - a pending room keeps its pending status after an admin edit
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const ownerEmail = 'o_' + stamp + '@example.com';
const adminEmail = 'a_' + stamp + '@example.com';
const password = 'TestPass123';

async function seed(role, email, phone) {
  const hash = await bcrypt.hash(password, 10);
  const r = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, is_kyc_verified, account_group) ' +
    'VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7) RETURNING id',
    ['QA ' + role, email, phone, hash, role, role === 'admin', v4()]
  );
  return r.rows[0].id;
}

async function apiLogin(identifier, role) {
  const r = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  });
  let d = await r.json();
  if (d.chooseRole) {
    const r2 = await fetch('http://localhost:3000/api/auth/select-account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, role })
    });
    d = await r2.json();
  }
  return d;
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

async function seedListing(ownerId, title, status) {
  const l = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price,
        price_per_head, base_price_per_head, location_area, nearest_landmark, status, poster_type,
        location_lat, location_lng, full_address)
     VALUES ($1,$2,'desc',1,900,900,900,900,'Testville','Test Landmark',$3,'owner',
        7.3399,-2.3266,'Testville, Ghana') RETURNING id, uuid`,
    [ownerId, title, status]
  );
  // Two photos so the edit form's "at least 2 photos" rule passes.
  for (let i = 0; i < 2; i++) {
    await db.query('INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES ($1,$2,$3,$4)',
      [l.rows[0].id, '/images/placeholder.jpg', i === 0, i]);
  }
  await db.query(`INSERT INTO amenities (listing_id, water, electricity, security, furnishing, bathroom)
     VALUES ($1,'constant','prepaid','gated','unfurnished','shared')`, [l.rows[0].id]);
  return l.rows[0];
}

export default async function run(page) {
  const out = {};
  const ownerId = await seed('owner', ownerEmail, '033' + String(stamp).slice(-7));
  const adminId = await seed('admin', adminEmail, '044' + String(stamp).slice(-7));
  const active = await seedListing(ownerId, 'QA Active Room', 'active');
  const pending = await seedListing(ownerId, 'QA Pending Room', 'pending');
  const ids = [active.id, pending.id];
  const otherOwnerIds = [];

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginUI(page, adminEmail);

    // ── Admin opens the ACTIVE listing detail page ──────────────
    await page.goto('http://localhost:3000/listing?id=' + active.uuid, { waitUntil: 'load' });
    await page.waitForSelector('#detailContent', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1200);
    out.admin_seesOwnerActions = await page.isVisible('#ownerActions');
    out.admin_seekerActionsHidden = !(await page.isVisible('#seekerActions'));
    out.admin_editHref = await page.$eval('#editListingBtn', el => el.getAttribute('href')).catch(() => null);
    out.admin_editHrefHasFrom = /from=/.test(out.admin_editHref || '');

    // ── Admin opens the edit page for someone else's listing ────
    await page.goto('http://localhost:3000' + out.admin_editHref, { waitUntil: 'load' });
    out.editPageLoaded = await page.waitForSelector('#editContent', { state: 'visible', timeout: 10000 })
      .then(() => true).catch(() => false);
    out.editLoadedTitle = await page.$eval('#edTitle', el => el.value).catch(() => null);
    // The Cancel link should point at the listing detail page (the `from`), not the dashboard.
    out.editCancelHref = await page.$eval('#editCancelLink', el => el.getAttribute('href')).catch(() => null);

    // Change the title and save, capturing any validation error on screen.
    const newTitle = 'QA Admin Edited Room X';
    await page.fill('#edTitle', newTitle);
    await page.click('#editSubmitBtn');
    await page.waitForTimeout(800);
    out.active_editError = await page.$eval('#editError', el => el.style.display !== 'none' ? el.textContent.trim() : null).catch(() => null);
    await page.waitForTimeout(2500);
    const afterEdit = await db.query('SELECT title, status FROM listings WHERE id=$1', [active.id]);
    out.active_titleAfterAdminEdit = afterEdit.rows[0].title;
    out.active_statusAfterAdminEdit = afterEdit.rows[0].status;
    out.active_editSaved = afterEdit.rows[0].title === newTitle;

    // ── Admin opens the PENDING listing detail page ─────────────
    await page.goto('http://localhost:3000/listing?id=' + pending.uuid, { waitUntil: 'load' });
    out.pending_detailVisible = await page.waitForSelector('#detailContent', { state: 'visible', timeout: 10000 })
      .then(() => true).catch(() => false);
    out.pending_ownerActionsVisible = await page.isVisible('#ownerActions');
    const pendingEditHref = await page.$eval('#editListingBtn', el => el.getAttribute('href')).catch(() => null);

    await page.goto('http://localhost:3000' + pendingEditHref, { waitUntil: 'load' });
    out.pending_editLoaded = await page.waitForSelector('#editContent', { state: 'visible', timeout: 10000 })
      .then(() => true).catch(() => false);
    const pendingTitle = 'QA Admin Pending Edited Room Y';
    await page.fill('#edTitle', pendingTitle);
    await page.click('#editSubmitBtn');
    await page.waitForTimeout(800);
    out.pending_editError = await page.$eval('#editError', el => el.style.display !== 'none' ? el.textContent.trim() : null).catch(() => null);
    await page.waitForTimeout(2500);
    const pendingAfter = await db.query('SELECT title, status FROM listings WHERE id=$1', [pending.id]);
    out.pending_titleAfterAdminEdit = pendingAfter.rows[0].title;
    out.pending_statusAfterAdminEdit = pendingAfter.rows[0].status;
    out.pending_editSaved = pendingAfter.rows[0].title === pendingTitle;

    // ── Server guards: straight API calls as the admin ──────────
    const adminTok = await apiLogin(adminEmail, 'admin');
    const editData = await fetch('http://localhost:3000/api/listings/' + pending.uuid + '/edit-data', {
      headers: { Authorization: 'Bearer ' + adminTok.token }
    });
    out.api_editDataStatus = editData.status;
    out.api_editDataHasListing = !!(await editData.json()).listing;

    // An owner must NOT be able to fetch edit-data for a listing they don't own.
    // Seed a SECOND owner who does not own these listings and try with their token.
    const otherOwnerEmail = 'oo_' + stamp + '@example.com';
    const otherOwnerId = await seed('owner', otherOwnerEmail, '055' + String(stamp).slice(-7));
    otherOwnerIds.push(otherOwnerId);
    const otherOwnerTok = await apiLogin(otherOwnerEmail, 'owner');
    const ownerEditData = await fetch('http://localhost:3000/api/listings/' + pending.uuid + '/edit-data', {
      headers: { Authorization: 'Bearer ' + otherOwnerTok.token }
    });
    out.api_otherOwnerEditDataStatus = ownerEditData.status;
    // ...and must not be able to SAVE an edit to it either.
    const fd = new FormData();
    fd.append('title', 'Hacked title');
    const ownerPut = await fetch('http://localhost:3000/api/listings/' + pending.uuid, {
      method: 'PUT', headers: { Authorization: 'Bearer ' + otherOwnerTok.token }, body: fd
    });
    out.api_otherOwnerPutStatus = ownerPut.status;

    return out;
  } finally {
    await db.query('DELETE FROM listings WHERE id = ANY($1::int[])', [ids]).catch(() => { });
    await db.query('DELETE FROM users WHERE id = ANY($1::int[])', [[ownerId, adminId, ...otherOwnerIds]]).catch(() => { });
  }
}
