// Regression QA: a seeker still gets the normal Browse-rooms experience.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'sk_' + stamp + '@example.com';
const phone = '066' + String(stamp).slice(-7);
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const ins = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Seeker Test',$1,$2,$3,'seeker',TRUE,$4) RETURNING id",
    [email, phone, hash, v4()]
  );
  const id = ins.rows[0].id;

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => location.pathname.startsWith('/home-seeker') || location.pathname.startsWith('/dashboard'), null, { timeout: 15000 });
    out.afterLogin = await page.evaluate(() => location.pathname);

    await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
    await page.waitForSelector('#listingsGrid', { timeout: 10000 });
    await page.waitForTimeout(1500);

    out.pageTitle = await page.title();
    out.toolbarHeading = await page.$eval('.results-toolbar h2', el => el.textContent.trim()).catch(() => null);
    out.filtersPanelById = !!(await page.$('#filtersPanel'));
    out.hasSearchInput = !!(await page.$('#searchLocation'));
    out.hasSortSelect = !!(await page.$('#sortSelect'));
    out.resultsCountText = await page.$eval('#resultsCount', el => el.textContent.trim()).catch(() => null);

    return out;
  } finally {
    await db.query('DELETE FROM users WHERE id=$1', [id]).catch(() => { });
  }
}
