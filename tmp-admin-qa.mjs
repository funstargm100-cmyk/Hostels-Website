// Verifies: clicking a request in Admin shows the price breakdown and the exact pin.
export default async function run(page, ui) {
  const out = {};
  const netLog = [];
  page.on('request', r => { if (r.url().includes('/api/admin/requests')) netLog.push(r.url()); });

  // 1) Log in as admin
  await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
  await page.fill('#loginIdentifier', 'admin@test.com');
  await page.fill('#loginPassword', 'password123');
  await page.click('#loginSubmitBtn');
  await page.waitForFunction(() => location.pathname !== '/login', null, { timeout: 15000 });
  out.afterLogin = new URL(page.url()).pathname;

  // 2) Go to the admin requests tab
  await page.goto('http://localhost:3000/admin', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.showAdminTab && window.showAdminTab('requests'));
  await page.waitForSelector('#adminRequestsTable table tbody tr', { timeout: 10000 });
  out.requestRows = await page.evaluate(() => document.querySelectorAll('#adminRequestsTable tbody tr').length);

  // 3) Click the first "Details" button
  await page.evaluate(() => {
    const btn = document.querySelector('#adminRequestsTable tbody tr button');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);

  // 4) Inspect the modal
  out.modal = await page.evaluate(() => {
    const pricing = document.getElementById('reqPricing');
    const coords = document.getElementById('reqCoords');
    const mapEl = document.getElementById('reqMap');
    const clean = (s) => s.replace(/\s+/g, ').trim();
    const lines = Array.from(document.querySelectorAll('#reqPricing .req-line')).map(l => clean(l.innerText));
    return {
      modalOpen: document.getElementById('requestModal').classList.contains('open'),
      pricingText: pricing ? clean(pricing.innerText) : null,
      pricingLines: lines,
      coordsText: coords ? clean(coords.innerText) : null,
      mapVisible: mapEl ? getComputedStyle(mapEl).display !== 'none' : false,
      leafletMounted: !!(mapEl && mapEl.querySelector('.leaflet-container, .leaflet-pane')),
      markerCount: mapEl ? mapEl.querySelectorAll('.leaflet-marker-icon').length : 0,
      gmLink: coords ? (coords.querySelector('a')?.href || null) : null
    };
  });

  out.netLog = netLog;
  return out;
}
