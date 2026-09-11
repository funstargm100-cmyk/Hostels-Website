// Minimal: read the listings map's options after it initialises.
const LISTINGS = [
  {
    uuid: 'a', title: 'Room A', location_area: 'Accra', price_per_head: 900, occupancy_type: 1,
    display_lat: 5.6037, display_lng: -0.187, location_lat: 5.6037, location_lng: -0.187
  },
  {
    uuid: 'b', title: 'Room B', location_area: 'Accra', price_per_head: 1200, occupancy_type: 2,
    display_lat: 5.63, display_lng: -0.16, location_lat: 5.63, location_lng: -0.16
  }
];
const ME = { user: { role: 'seeker', base_lat: 5.60, base_lng: -0.19 } };
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

export default async function run(page) {
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAV ->', f.url()); });
  page.on('pageerror', (e) => console.log('PAGEERROR ->', e.message));
  const hits = [];
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    hits.push(url);
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
  await page.waitForTimeout(600);

  // NOTE: a plain page.evaluate can land in an isolated world under patchright,
  // where the page's window.__mapInstance is not visible. waitForFunction runs
  // with main-world access, so read the map through it and return the object.
  const result = await page.waitForFunction(() => {
    const m = window.__mapInstance;
    if (!m || typeof m.getCenter !== 'function') return false;
    const c = m.getCenter();
    return {
      draggingOption: m.options.dragging,
      draggingEnabled: m.dragging && m.dragging.enabled(),
      scrollWheelZoom: m.options.scrollWheelZoom,
      touchZoom: m.options.touchZoom,
      rotate: m.options.rotate,
      canRotate: typeof m.setBearing === 'function',
      hasZoomControl: !!document.querySelector('.leaflet-control-zoom'),
      hasRotateControl: !!document.querySelector('.leaflet-control-rotate, .leaflet-rotate'),
      markerCount: document.querySelectorAll('.leaflet-marker-icon').length,
      center: { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) },
      currentUrl: location.pathname
    };
  }, null, { timeout: 20000, polling: 200 }).then((h) => h.jsonValue());
  result.stubbedCalls = hits;
  return result;
}
