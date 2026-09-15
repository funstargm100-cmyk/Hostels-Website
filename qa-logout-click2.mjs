// QA: assert the mobile logout button on /dashboard is wired to the logout
// handler — click it, auto-accept the confirm, expect token cleared + "/".
export default async function run(page) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (url.includes('/api/auth/me')) return json({ user: { id: 1, name: 'QA', role: 'seeker' } });
    if (url.includes('/api/listings')) return json({ listings: [], total: 0 });
    return json({});
  });
  // Seed BEFORE the document scripts run, and again on every navigation.
  await page.addInitScript(() => {
    localStorage.setItem('token', 'qa-fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'seeker', name: 'QA' }));
  });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
  // Retry the load until dashboard.js has actually mounted (login redirect races).
  for (let i = 0; i < 5 && await page.evaluate(() => !window.dashboardShowTab); i++) {
    await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(600);

  const mounted = await page.evaluate(() => typeof window.dashboardShowTab === 'function');
  const btn = await page.evaluate(() => {
    const el = document.getElementById('logoutBtnMobile');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { exists: true, display: cs.display, text: el.innerText.trim() };
  });

  if (!mounted || !btn || btn.display === 'none') {
    return { mounted, btn, note: 'not mounted / button hidden — cannot click' };
  }

  page.on('dialog', (d) => d.accept());
  await page.click('#logoutBtnMobile');
  await page.waitForTimeout(1500);

  return {
    mounted,
    btn,
    after: await page.evaluate(() => ({
      token: !!localStorage.getItem('token'),
      user: !!localStorage.getItem('user'),
      path: location.pathname
    }))
  };
}
