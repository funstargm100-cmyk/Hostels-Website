// QA: owners can't browse rooms — /listings becomes their own listings manager,
// and their listings have an Edit action that opens the edit page.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'own_' + stamp + '@example.com';
const phone = '055' + String(stamp).slice(-7);
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);

  // Seed an owner with one active listing.
  const ownerIns = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group, is_kyc_verified) ' +
    "VALUES ('Owner Test',$1,$2,$3,'owner',TRUE,$4,TRUE) RETURNING id",
    [email, phone, hash, v4()]
  );
  const ownerId = ownerIns.rows[0].id;

  const listingIns = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, status)
     VALUES ($1,'Owner QA Room','A room for the QA run',2,1000,1000,500,'Testville','active') RETURNING id, uuid`,
    [ownerId]
  );
  const listingId = listingIns.rows[0].id;
  const listingUuid = listingIns.rows[0].uuid;

  await db.query(
    `INSERT INTO amenities (listing_id, water, electricity, furnishing, bathroom, wifi)
     VALUES ($1,'constant','prepaid','furnished','private',TRUE)`,
    [listingId]
  );

  try {
    // Log in as the owner through the real UI.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => location.pathname.startsWith('/home-agent') || location.pathname.startsWith('/dashboard'), null, { timeout: 15000 });
    out.afterLogin = await page.evaluate(() => location.pathname);

    // Go to /listings — should render the OWNER view, not the browse page.
    await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
    await page.waitForSelector('#listingsGrid', { timeout: 10000 });
    await page.waitForTimeout(1500);

    out.pageTitle = await page.title();
    out.toolbarHeading = await page.$eval('.results-toolbar h2', el => el.textContent.trim()).catch(() => null);
    out.filtersPanelById = !!(await page.$('#filtersPanel'));
    out.hasSearchInput = !!(await page.$('#searchLocation'));
    out.hasSortSelect = !!(await page.$('#sortSelect'));
    out.ownerCardCount = await page.$$eval('#listingsGrid .card', els => els.length).catch(() => -1);
    out.editLinks = await page.$$eval('#listingsGrid a[href^="/edit-listing"]', els => els.map(e => e.getAttribute('href'))).catch(() => []);
    out.resultsCountText = await page.$eval('#resultsCount', el => el.textContent.trim()).catch(() => null);
    out.hasOwnListing = (await page.textContent('#listingsGrid').catch(() => '')).includes('Owner QA Room');

    // The Edit link should open the edit page with the listing prefilled.
    if (out.editLinks.length) {
      await page.goto('http://localhost:3000' + out.editLinks[0], { waitUntil: 'load' });
      await page.waitForSelector('#editContent', { state: 'visible', timeout: 10000 });
      out.editPageTitleField = await page.$eval('#edTitle', el => el.value);
      out.editPageLocation = await page.evaluate(() => location.pathname);
      out.editPageVisible = await page.isVisible('#editForm');
    }

    // Dashboard should also expose an Edit action for the listing.
    await page.goto('http://localhost:3000/dashboard#listings', { waitUntil: 'load' });
    await page.waitForSelector('#ownerListings', { timeout: 10000 });
    await page.waitForTimeout(1500);
    out.dashboardEditLinks = await page.$$eval('#ownerListings a[href^="/edit-listing"]', els => els.map(e => e.getAttribute('href'))).catch(() => []);

    return out;
  } finally {
    await db.query('DELETE FROM listings WHERE id=$1', [listingId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
}
