// Verify room-name labels render on map markers.
const LISTINGS = [
  {
    uuid: 'a', title: 'Sunny 1-Bedroom at Airport Res', location_area: 'Accra', price_per_head: 900, occupancy_type: 1,
    display_lat: 5.6037, display_lng: -0.187, location_lat: 5.6037, location_lng: -0.187
  },
  {
    uuid: 'b', title: 'Cozy Room East Legon', location_area: 'Accra', price_per_head: 1200, occupancy_type: 2,
    display_lat: 5.62, display_lng: -0.17, location_lat: 5.62, location_lng: -0.17
  }
];
const ME = { user: { role: 'seeker', base_lat: 5.60, base_lng: -0.19 } };
const ROUTE = { route: { coords: [[5.60, -0.19], [5.6037, -0.187]] } };
const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

export default async function run(page) {
  await page.route('**/api/**', (r) => {
    const u = r.request().url();
    if (u.includes('/api/auth/me')) return r.fulfill(json(ME));
    if (u.includes('/api/listings')) return r.fulfill(json({ listings: LISTINGS, total: 2 }));
    if (u.includes('/api/geo/route')) return r.fulfill(json(ROUTE));
    return r.fulfill(json({}));
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 't');
    localStorage.setItem('user', JSON.stringify({ name: 'S', role: 'seeker' }));
  });
  await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 30000 });
  await page.click('#mapViewBtn');
  await page.waitForFunction(() => !!window.__mapInstance, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  return await page.waitForFunction(() => {
    const labels = Array.from(document.querySelectorAll('#mapSearch .leaflet-tooltip.map-pin-label'));
    return {
      labelCount: labels.length,
      labelTexts: labels.map((l) => l.textContent),
      labelsVisible: labels.map((l) => { const r = l.getBoundingClientRect(); return r.width > 0 && r.height > 0; }),
      markerCount: document.querySelectorAll('#mapSearch .leaflet-marker-icon').length
    };
  }, null, { polling: 150 }).then((h) => h.jsonValue());
}
