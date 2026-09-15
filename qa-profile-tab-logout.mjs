// QA: on mobile, the seeker's Profile/Account tab on /dashboard keeps the
// top-nav logout button visible.
export default async function run(page, ui) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const json = (obj) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(obj)
    });
    if (url.includes('/api/auth/me')) return json({ user: { id: 1, name: 'QA', role: 'seeker' } });
    if (url.includes('/api/user/profile')) return json({ user: { id: 1, name: 'QA', role: 'seeker', created_at: '2024-01-01', phone: '', email: 'qa@example.com' }, has_active_request: false });
    if (url.includes('/api/user/favorites')) return json({ listings: [] });
    if (url.includes('/api/listings')) return json({ listings: [], total: 0 });
    return json({});
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'qa-fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'seeker', name: 'QA' }));
  });

  await page.setViewportSize({ width: 375, height: 800 });
  // Open straight on the Profile/Account tab.
  await page.goto('http://localhost:3000/dashboard#account', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  // Re-assert auth in case the guard ran before init script took hold.
  await page.evaluate(() => {
    localStorage.setItem('token', 'qa-fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'seeker', name: 'QA' }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const readState = () => page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    return {
      hash: location.hash,
      accountTabShown: visible(document.getElementById('tab-account')),
      mobileLogoutVisible: visible(document.getElementById('logoutBtnMobile'))
    };
  });

  return await readState();
}
