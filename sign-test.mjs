// Determine the correct panBy sign to move map CONTENT down/right on screen.
const LISTINGS = [
  {
    uuid: 'a', title: 'Room A', location_area: 'Accra', price_per_head: 900, occupancy_type: 1,
    display_lat: 5.6037, display_lng: -0.187, location_lat: 5.6037, location_lng: -0.187
  }
];
const ME = { user: { role: 'seeker', base_lat: 5.60, base_lng: -0.19 } };
const json = (b) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

export default async function run(page) {
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/auth/me')) return route.fulfill(json(ME));
    if (url.includes('/api/listings')) return route.fulfill(json({ listings: LISTINGS, total: 1 }));
    return route.fulfill(json({}));
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ name: 'Seeker', role: 'seeker' }));
  });

  await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 30000 });
  await page.click('#mapViewBtn');
  await page.waitForFunction(() => !!window.__mapInstance, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  return await page.waitForFunction(() => {
    const m = window.__mapInstance;
    const cr = document.getElementById('mapSearch').getBoundingClientRect();
    const markers = [];
    m.eachLayer((l) => { if (l instanceof L.Marker) markers.push(l); });
    const t = markers[0];
    const iconY = () => Math.round(t._icon.getBoundingClientRect().top - cr.top);
    const before = iconY();
    // Pan content by +100 px vertically, see which way the marker moves.
    m.panBy([0, 100], { animate: false });
    const afterPos100 = iconY();
    m.panBy([0, -200], { animate: false }); // reset-ish
    const afterNeg100 = iconY();
    return { before, afterPos100, afterNeg100, note: 'positive panBy y => marker moves ?' };
  }, null, { polling: 150 }).then(h => h.jsonValue());
}
