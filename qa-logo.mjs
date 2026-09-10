// QA: the top-bar logo should point at the user's role home on EVERY page,
// not the visitor page. Visitors must still get "/".
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const ownerEmail = 'lg_own_' + stamp + '@example.com';
const seekerEmail = 'lg_seek_' + stamp + '@example.com';
const password = 'TestPass123';

async function seed(role, email, phone) {
  const hash = await bcrypt.hash(password, 10);
  const r = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    'VALUES ($1,$2,$3,$4,$5,TRUE,$6) RETURNING id',
    ['Logo ' + role, email, phone, hash, role, v4()]
  );
  return r.rows[0].id;
}

async function loginUI(page, email) {
  await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
  await page.fill('#loginIdentifier', email);
  await page.fill('#loginPassword', password);
  await page.click('#loginSubmitBtn');
  await page.waitForFunction(
    () => ['/home-seeker', '/home-agent', '/dashboard'].some(p => location.pathname.startsWith(p)),
    null, { timeout: 15000 }
  );
}

// The first nav-bar logo (not the footer one) is what the report is about.
const navLogoHref = (page) =>
  page.$eval('.navbar a.logo', el => el.getAttribute('href')).catch(() => null);

export default async function run(page) {
  const out = {};
  const ownerId = await seed('owner', ownerEmail, '055' + String(stamp).slice(-7));
  const seekerId = await seed('seeker', seekerEmail, '066' + String(stamp).slice(-7));

  const pages = ['/listings', '/about', '/post-ad', '/listing'];

  try {
    // ── Visitor: logo stays "/" ─────────────────────────
    await page.goto('http://localhost:3000/about', { waitUntil: 'load' });
    await page.waitForTimeout(800);
    out.visitorAboutLogo = await navLogoHref(page);

    // ── Owner: logo -> /home-agent on every page ────────
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginUI(page, ownerEmail);
    out.ownerLanded = await page.evaluate(() => location.pathname);
    out.owner = {};
    for (const p of pages) {
      await page.goto('http://localhost:3000' + p, { waitUntil: 'load' });
      await page.waitForTimeout(900);
      out.owner[p] = await navLogoHref(page);
    }

    // ── Seeker: logo -> /home-seeker on every page ──────
    await loginUI(page, seekerEmail);
    out.seekerLanded = await page.evaluate(() => location.pathname);
    out.seeker = {};
    for (const p of pages) {
      await page.goto('http://localhost:3000' + p, { waitUntil: 'load' });
      await page.waitForTimeout(900);
      out.seeker[p] = await navLogoHref(page);
    }

    return out;
  } finally {
    await db.query('DELETE FROM users WHERE id IN ($1,$2)', [ownerId, seekerId]).catch(() => { });
  }
}
