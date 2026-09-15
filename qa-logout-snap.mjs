export default async function run(page, ui) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (url.includes('/api/auth/me')) return json({ user: { id: 1, name: 'QA', role: 'seeker' } });
    if (url.includes('/api/listings')) return json({ listings: [], total: 0 });
    return json({});
  });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('token', 'qa-fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'seeker', name: 'QA' }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const snap = await ui.snapshot();
  const info = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#logoutBtnMobile, #sidebarLogout, #logoutBtn').forEach(el => {
      out.push({ id: el.id, text: el.innerText.trim(), display: getComputedStyle(el).display });
    });
    return out;
  });
  return { info, snap };
}
