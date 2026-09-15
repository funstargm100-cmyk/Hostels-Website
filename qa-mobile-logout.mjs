// QA: mobile logout buttons in the top nav bar on /dashboard and /poster-profile.
// Stubs the auth + data APIs and seeds localStorage so each page renders its
// authenticated nav state, then reports which logout affordances are visible.
export default async function run(page) {
  const results = {};

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const json = (obj) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(obj)
    });
    if (url.includes('/api/auth/me')) {
      return json({ user: { id: 1, name: 'QA User', role: 'seeker', email: 'qa@example.com' } });
    }
    if (url.includes('/api/listings')) return json({ listings: [], total: 0, page: 1 });
    if (url.includes('/api/notifications')) return json({ notifications: [] });
    if (/\/api\/users\//.test(url)) return json({
      poster: { name: 'QA Owner', role: 'agent', is_kyc_verified: true, created_at: '2024-01-01', listing_count: 0 },
      followers: 0, following: false, listings: []
    });
    return json({});
  });

  // Seed auth BEFORE any page script runs, so the guard never fires.
  await page.addInitScript(() => {
    localStorage.setItem('token', 'qa-fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'seeker', name: 'QA User' }));
  });

  const inspectAt = async (url, width) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    return page.evaluate(() => {
      const visible = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const byId = (id) => document.getElementById(id);
      return {
        path: location.pathname,
        desktopLogout: visible(byId('logoutBtn')),
        mobileLogout: visible(byId('logoutBtnMobile')),
        sidebarLogout: visible(byId('sidebarLogout'))
      };
    });
  };

  for (const url of ['http://localhost:3000/dashboard', 'http://localhost:3000/poster-profile?id=1']) {
    results[url] = {
      phone375: await inspectAt(url, 375),
      desktop1200: await inspectAt(url, 1200)
    };
  }

  return results;
}
