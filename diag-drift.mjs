// Measure marker drift vs its true anchor as the map is rotated.
const LISTINGS = [
  {
    uuid: 'a', title: 'Room A', location_area: 'Accra', price_per_head: 900, occupancy_type: 1,
    display_lat: 5.6037, display_lng: -0.187, location_lat: 5.6037, location_lng: -0.187
  },
  {
    uuid: 'b', title: 'Room B', location_area: 'Accra', price_per_head: 1200, occupancy_type: 2,
    display_lat: 5.61, display_lng: -0.17, location_lat: 5.61, location_lng: -0.17
  }
];
const ME = { user: { role: 'seeker', base_lat: 5.60, base_lng: -0.19 } };
const json = (b) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

export default async function run(page) {
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/auth/me')) return route.fulfill(json(ME));
    if (url.includes('/api/listings')) return route.fulfill(json({ listings: LISTINGS, total: 2 }));
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
  await page.waitForTimeout(1500);

  const measure = () => page.waitForFunction(() => {
    const m = window.__mapInstance;
    const cr = document.getElementById('mapSearch').getBoundingClientRect();
    // Where Leaflet THINKS the marker's lat/lng is on screen (container px).
    // latLngToContainerPoint is NOT rotation-aware in this plugin, so compare it
    // against the marker icon's actual painted position.
    const markers = [];
    m.eachLayer(() => { });
    document.querySelectorAll('#mapSearch .leaflet-marker-icon').forEach((icon) => {
      const r = icon.getBoundingClientRect();
      markers.push({ x: Math.round(r.left - cr.left + r.width / 2), y: Math.round(r.top - cr.top + r.height / 2) });
    });
    // True anchor: use the plugin's rotation-aware conversion if present.
    const probe = m.getCenter();
    const centerPx = { x: cr.width / 2, y: cr.height / 2 };
    return { bearing: Math.round(m.getBearing()), markers, centerLatLng: { lat: +probe.lat.toFixed(5), lng: +probe.lng.toFixed(5) }, size: { w: Math.round(cr.width), h: Math.round(cr.height) } };
  }, null, { polling: 150 }).then(h => h.jsonValue());

  const bearing0 = await measure();
  await page.waitForFunction(() => { window.__mapInstance.setBearing(45); return true; }, null, { polling: 100 });
  await page.waitForTimeout(700);
  const bearing45 = await measure();
  await page.waitForFunction(() => { window.__mapInstance.setBearing(90); return true; }, null, { polling: 100 });
  await page.waitForTimeout(700);
  const bearing90 = await measure();

  return { bearing0, bearing45, bearing90 };
}
