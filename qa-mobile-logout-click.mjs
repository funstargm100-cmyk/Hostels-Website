// QA: the mobile logout button on /dashboard actually logs out (clears token,
// accepts the confirm dialog, and lands on "/").
export default async function run(page, ui) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const json = (obj) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(obj)
    });
    if (url.includes('/api/auth/me')) return json({ user: { id: 1, name: 'QA', role: 'seeker' } });
    if (url.includes('/api/listings')) return json({ listings: [], total: 0 });
    return json({});
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'qa-fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'seeker', name: 'QA' }));
  });

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  page.on('dialog', (d) => d.accept());

  const before = await page.evaluate(() => ({
    token: !!localStorage.getItem('token'),
    path: location.pathname
  }));

  const snap = await ui.snapshot();
  const ref = snap.match(/@(e\d+) button "Log out"/)?.[1];
  if (!ref) return { error: 'mobile logout button not in snapshot', snap };

  await ui.click(ref);
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => ({
    token: !!localStorage.getItem('token'),
    path: location.pathname
  }));

  return { before, after };
}
