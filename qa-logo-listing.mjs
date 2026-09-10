// Confirm the logo is role-aware on a REAL listing page (with an id).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'lg2_' + stamp + '@example.com';
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const ownerIns = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Logo Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '077' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = ownerIns.rows[0].id;
  const listingIns = await db.query(
    `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, status)
     VALUES ($1,'Logo Test Room','desc',1,900,900,900,'Testville','active') RETURNING id, uuid`,
    [ownerId]
  );
  const listingId = listingIns.rows[0].id;
  const uuid = listingIns.rows[0].uuid;

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    // Log in as the owner
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => location.pathname.startsWith('/home-agent'), null, { timeout: 15000 });

    // Open the real listing page
    await page.goto('http://localhost:3000/listing?id=' + uuid, { waitUntil: 'load' });
    await page.waitForSelector('.navbar a.logo', { timeout: 10000 });
    await page.waitForTimeout(1200);
    out.listingUrl = await page.evaluate(() => location.pathname + location.search);
    out.listingLogoHref = await page.$eval('.navbar a.logo', el => el.getAttribute('href'));

    return out;
  } finally {
    await db.query('DELETE FROM listings WHERE id=$1', [listingId]).catch(() => { });
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
}
