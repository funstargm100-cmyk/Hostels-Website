// QA: the admin panel has a Settings tab with a change-password form and a
// logout control (sidebar + settings card). Verifies:
//   - the admin can sign in and open the Settings tab
//   - changing the password via the form works, and the NEW password is required
//     to sign in again (the old one no longer works)
//   - the sidebar/Settings logout clears the session and returns to the home page
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const adminEmail = 'adm_' + stamp + '@example.com';
const password = 'TestPass123';
const newPassword = 'NewPass456';

async function seedAdmin(email) {
  const hash = await bcrypt.hash(password, 10);
  const r = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, is_kyc_verified, account_group) ' +
    'VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,$6) RETURNING id',
    ['QA Admin', email, '077' + String(stamp).slice(-7), hash, 'admin', v4()]
  );
  return r.rows[0].id;
}

async function loginUI(page, email, pw) {
  await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
  await page.fill('#loginIdentifier', email);
  await page.fill('#loginPassword', pw);
  await page.click('#loginSubmitBtn');
  await page.waitForFunction(
    () => ['/home-seeker', '/home-agent', '/dashboard', '/admin'].some(p => location.pathname.startsWith(p)),
    null, { timeout: 15000 });
}

export default async function run(page) {
  const out = {};
  const adminId = await seedAdmin(adminEmail);

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginUI(page, adminEmail, password);
    out.landedOnAdmin = page.url().includes('/admin');

    // ── Sidebar has the new Settings link + logout button ──
    out.sidebarHasSettingsLink = !!(await page.$('a[onclick*="settings"]'));
    out.sidebarHasLogoutBtn = !!(await page.$('#adminSidebarLogout'));
    // Expand the (desktop-default-collapsed) sidebar so the nav + logout button
    // are visible for a screenshot.
    await page.click('#sidebarToggle');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'admin-sidebar.png', fullPage: false });

    // ── Open the Settings tab via the real sidebar link ──
    await page.click('a[onclick*="settings"]');
    await page.waitForTimeout(400);
    out.settingsTabVisible = await page.isVisible('#admin-tab-settings');
    out.hasPasswordForm = !!(await page.$('#adminPasswordForm'));
    out.hasSettingsLogout = !!(await page.$('#adminSettingsLogout'));
    await page.screenshot({ path: 'admin-settings.png', fullPage: true });

    // ── Mismatch is rejected client-side, and nothing is saved ──
    await page.fill('#adminCurPw', password);
    await page.fill('#adminNewPw', 'aaaaaa');
    // A valid-length but DIFFERENT confirm, so native minlength does not block the
    // submit and our own "do not match" guard is what runs.
    await page.fill('#adminConfPw', 'cccccc');
    await page.click('#adminPasswordForm button[type="submit"]');
    await page.waitForTimeout(500);
    out.mismatchToastShown = await page.evaluate(() =>
      [...document.querySelectorAll('#toastContainer *')].some(n => /do not match/i.test(n.textContent)));
    // Still the ORIGINAL password in the DB.
    const afterMismatch = await db.query('SELECT password_hash FROM users WHERE id=$1', [adminId]);
    out.originalStillValidAfterMismatch = await bcrypt.compare(password, afterMismatch.rows[0].password_hash);

    // ── Wrong current password is rejected by the server ──
    await page.fill('#adminCurPw', 'wrong-current');
    await page.fill('#adminNewPw', newPassword);
    await page.fill('#adminConfPw', newPassword);
    await page.click('#adminPasswordForm button[type="submit"]');
    await page.waitForTimeout(800);
    out.wrongCurrentToastShown = await page.evaluate(() =>
      [...document.querySelectorAll('#toastContainer *')].some(n => /current password is incorrect/i.test(n.textContent)));

    // ── Correct change succeeds ──
    await page.fill('#adminCurPw', password);
    await page.fill('#adminNewPw', newPassword);
    await page.fill('#adminConfPw', newPassword);
    await page.click('#adminPasswordForm button[type="submit"]');
    await page.waitForTimeout(900);
    const afterChange = await db.query('SELECT password_hash FROM users WHERE id=$1', [adminId]);
    out.newPasswordStored = await bcrypt.compare(newPassword, afterChange.rows[0].password_hash);
    out.oldPasswordRejected = !(await bcrypt.compare(password, afterChange.rows[0].password_hash));
    out.formClearedAfterSave = await page.$eval('#adminNewPw', el => el.value === '');

    // ── Sidebar logout returns to the public home and clears the token ──
    page.on('dialog', d => d.accept()); // accept the confirm()
    await page.click('#adminSidebarLogout');
    await page.waitForTimeout(1500);
    out.afterLogoutUrl = page.url();
    out.afterLogoutTokenCleared = await page.evaluate(() => !localStorage.getItem('token'));

    // ── The account can still sign in with the NEW password ──
    await loginUI(page, adminEmail, newPassword);
    out.reLoginWithNewPasswordOk = page.url().includes('/admin');

    return out;
  } finally {
    await db.query('DELETE FROM users WHERE id=$1', [adminId]).catch(() => { });
  }
}
