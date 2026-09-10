// QA: on a listing detail page, the OWNER sees management actions (edit /
// deactivate / reactivate / delete) and NOT request/favorite — and the server
// rejects self-requests and self-favorites. Seekers still see Request/Favorite.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const ownerEmail = 'o_' + stamp + '@example.com';
const seekerEmail = 's_' + stamp + '@example.com';
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
  await page.waitForFunction(() => ['/home-seeker', '/home-agent', '/dashboard'].some(p => location.pathname.startsWith(p)), null, { timeout: 15000 });
}

export default async function run(page) {
  const out = {};
  const ownerId = await seed('owner', ownerEmail, '011' + String(stamp).slice(-7));
  const seekerId = await seed('seeker', seekerEmail, '022' + String(stamp).slice(-7));

  const lIns = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, status)
     VALUES ($1,'QA Detail Room','desc',1,900,900,900,'Testville','active') RETURNING id, uuid`,
    [ownerId]
  );
  const listingId = lIns.rows[0].id;
  const uuid = lIns.rows[0].uuid;

  try {
    await page.setViewportSize({ width: 1280, height: 900 });

    // ── OWNER viewing their own listing ──────────────
    await loginUI(page, ownerEmail);
    await page.goto('http://localhost:3000/listing?id=' + uuid, { waitUntil: 'load' });
    await page.waitForSelector('#detailContent', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1200);

    out.owner_seekerActionsHidden = !(await page.isVisible('#seekerActions'));
    out.owner_ownerActionsVisible = await page.isVisible('#ownerActions');
    out.owner_editHref = await page.$eval('#editListingBtn', el => el.getAttribute('href')).catch(() => null);
    out.owner_btnLabel = await page.$eval('#deactivateBtnLabel', el => el.textContent.trim()).catch(() => null);
    out.owner_deleteBtnPresent = !!(await page.$('#ownerActions button[onclick="deleteListing()"]'));
    await page.screenshot({ path: 'owner-listing-actions.png', fullPage: false });

    // Deactivate via the UI button.
    await page.click('#deactivateListingBtn');
    await page.waitForTimeout(1200);
    out.owner_btnLabelAfterDeactivate = await page.$eval('#deactivateBtnLabel', el => el.textContent.trim()).catch(() => null);
    const statusRow = await db.query('SELECT status FROM listings WHERE id=$1', [listingId]);
    out.owner_dbStatusAfterDeactivate = statusRow.rows[0].status;

    // Reactivate via the UI button.
    await page.click('#deactivateListingBtn');
    await page.waitForTimeout(1200);
    out.owner_btnLabelAfterReactivate = await page.$eval('#deactivateBtnLabel', el => el.textContent.trim()).catch(() => null);
    const statusRow2 = await db.query('SELECT status FROM listings WHERE id=$1', [listingId]);
    out.owner_dbStatusAfterReactivate = statusRow2.rows[0].status;

    // ── Server guards: owner hitting the APIs directly ──
    const ownerTok = await apiLogin(ownerEmail, 'owner');
    const favRes = await fetch('http://localhost:3000/api/listings/' + uuid + '/favorite', {
      method: 'POST', headers: { Authorization: 'Bearer ' + ownerTok.token }
    });
    out.api_selfFavoriteStatus = favRes.status;
    const reqRes = await fetch('http://localhost:3000/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ownerTok.token },
      body: JSON.stringify({ listing_uuid: uuid, seeker_name: 'Self', seeker_phone: '0200000' })
    });
    out.api_selfRequestStatus = reqRes.status;

    // ── SEEKER viewing the listing: normal actions ──
    await loginUI(page, seekerEmail);
    await page.goto('http://localhost:3000/listing?id=' + uuid, { waitUntil: 'load' });
    await page.waitForSelector('#detailContent', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1200);
    out.seeker_seekerActionsVisible = await page.isVisible('#seekerActions');
    out.seeker_ownerActionsHidden = !(await page.isVisible('#ownerActions'));
    out.seeker_hasRequestBtn = !!(await page.$('button[onclick="openInterestModal()"]'));
    out.seeker_hasFavBtn = !!(await page.$('#favBtn'));

    // ── OWNER opening a DEACTIVATED listing (reactivation path) ──
    await db.query("UPDATE listings SET status='deactivated' WHERE id=$1", [listingId]);
    await loginUI(page, ownerEmail);
    await page.goto('http://localhost:3000/listing?id=' + uuid, { waitUntil: 'load' });
    await page.waitForSelector('#ownerActions', { state: 'visible', timeout: 10000 }).catch(() => { });
    await page.waitForTimeout(1000);
    out.ownerCanOpenDeactivated = await page.isVisible('#detailContent');
    out.ownerDeactivatedBtnLabel = await page.$eval('#deactivateBtnLabel', el => el.textContent.trim()).catch(() => null);

    return out;
  } finally {
    await db.query('DELETE FROM listings WHERE id=$1', [listingId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id IN ($1,$2)', [ownerId, seekerId]).catch(() => { });
  }
}
