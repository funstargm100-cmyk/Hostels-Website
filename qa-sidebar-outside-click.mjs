// Browser QA: clicking OUTSIDE the side panel must collapse it.
// Covers the dashboard drawer (mobile) and the admin sidebar (desktop).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'sa_' + stamp + '@example.com';
const phone = '088' + String(stamp).slice(-7);
const password = 'TestPass123';

async function seed(role, name) {
  const hash = await bcrypt.hash(password, 10);
  const r = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group, is_kyc_verified) ' +
    'VALUES ($1,$2,$3,$4,$5,TRUE,$6,TRUE) RETURNING id',
    [name, email, phone, hash, role, v4()]
  );
  return r.rows[0].id;
}

async function apiLogin(identifier, role) {
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  });
  const data = await res.json();
  if (data.chooseRole) {
    const res2 = await fetch('http://localhost:3000/api/auth/select-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, role })
    });
    return res2.json();
  }
  return data;
}

function seedSession(page, token, user) {
  return page.addInitScript(([t, u]) => {
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify(u));
  }, [token, user]);
}

export default async function run(page) {
  const out = {};
  const seekerId = await seed('seeker', 'Sidebar Seeker');
  const adminId = await seed('admin', 'Sidebar Admin');

  try {
    // ── Dashboard (mobile width -> off-canvas drawer) ─────────────
    await page.setViewportSize({ width: 480, height: 820 });
    const seekerLogin = await apiLogin(email, 'seeker');
    out.seekerLoginOk = !!seekerLogin.token;
    await seedSession(page, seekerLogin.token, seekerLogin.user);
    // Capture any page-level errors so a silent script failure is visible.
    out.pageErrors = [];
    page.on('pageerror', (err) => out.pageErrors.push(String(err)));
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'load' });
    await page.waitForSelector('#dashboardSidebar', { timeout: 15000 });
    // Wait until the deferred dashboard scripts have actually run.
    await page.waitForFunction(() => typeof window.toggleMobileSidebar === 'function', null, { timeout: 10000 }).catch(() => { });
    out.dashboardPath = await page.evaluate(() => location.pathname);

    // Open the drawer via the hamburger.
    out.toggleInfo = await page.evaluate(() => {
      const b = document.getElementById('sidebarMobileToggle');
      return b ? { exists: true, visible: b.offsetParent !== null, w: b.offsetWidth, h: b.offsetHeight } : { exists: false };
    });
    out.probe = await page.evaluate(() => {
      return {
        href: location.href,
        title: document.title,
        hasShell: !!document.getElementById('dashboardShell'),
        hasSidebar: !!document.getElementById('dashboardSidebar'),
        hasLoginForm: !!document.getElementById('loginForm'),
        fnType: typeof window.toggleMobileSidebar,
        appFn: typeof window.initNavAuth,
        mq: window.matchMedia('(max-width:900px)').matches
      };
    });
    if (typeof out.probe.fnType !== 'string' || out.probe.fnType === 'undefined') { out.stoppedEarly = true; return out; }
    await page.waitForTimeout(300);
    out.dashboardOpened = await page.evaluate(() => document.getElementById('dashboardShell').classList.contains('mobile-sidebar-open'));
    if (out.dashboardOpened) {
      // Close it, then try the real user gesture (click) for the outside-click test.
      await page.evaluate(() => window.toggleMobileSidebar(false));
      await page.waitForTimeout(200);
    }
    await page.click('#sidebarMobileToggle');
    await page.waitForTimeout(400);
    out.dashboardOpenedByClick = await page.evaluate(() => document.getElementById('dashboardShell').classList.contains('mobile-sidebar-open'));
    if (!out.dashboardOpenedByClick) { out.stoppedEarly = true; return out; }

    // Click on the page CONTENT (outside the panel; the backdrop is behind it).
    await page.mouse.click(430, 700);
    await page.waitForTimeout(400);
    out.dashboardClosedAfterOutsideClick = await page.evaluate(() => !document.getElementById('dashboardShell').classList.contains('mobile-sidebar-open'));

    // Re-open and click a nav link INSIDE the panel: stays in normal nav flow.
    await page.click('#sidebarMobileToggle');
    await page.waitForTimeout(250);
    out.dashboardReopened = await page.evaluate(() => document.getElementById('dashboardShell').classList.contains('mobile-sidebar-open'));
    await page.evaluate(() => { const a = document.querySelector('#sidebarNav a[data-tab]'); if (a) a.click(); });
    await page.waitForTimeout(300);
    out.dashboardClosedAfterTabClick = await page.evaluate(() => !document.getElementById('dashboardShell').classList.contains('mobile-sidebar-open'));

    // ── Admin (desktop) ─────────────
    const adminLogin = await apiLogin(email, 'admin');
    out.adminLoginOk = !!adminLogin.token && adminLogin.user.role === 'admin';
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://localhost:3000/admin', { waitUntil: 'domcontentloaded' });
    await page.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [adminLogin.token, adminLogin.user]);
    await page.goto('http://localhost:3000/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#adminSidebar', { timeout: 15000 });
    out.adminPath = await page.evaluate(() => location.pathname);

    // Simulate the pinned-open desktop sidebar, then click the content area.
    await page.evaluate(() => document.getElementById('adminShell').classList.remove('sidebar-collapsed'));
    out.adminExpanded = await page.evaluate(() => !document.getElementById('adminShell').classList.contains('sidebar-collapsed'));

    await page.mouse.click(1100, 600);
    await page.waitForTimeout(400);
    out.adminCollapsedAfterOutsideClick = await page.evaluate(() => document.getElementById('adminShell').classList.contains('sidebar-collapsed'));

    return out;
  } finally {
    await db.query('DELETE FROM users WHERE id IN ($1,$2)', [seekerId, adminId]);
  }
}
