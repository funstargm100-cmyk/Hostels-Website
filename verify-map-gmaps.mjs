// Verify the Google-Maps-style map search mode.
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

  const readMap = () => page.waitForFunction(() => {
    const m = window.__mapInstance;
    return {
      draggingEnabled: m.dragging && m.dragging.enabled(),
      scrollWheelZoom: m.options.scrollWheelZoom,
      touchZoom: m.options.touchZoom,
      rotate: m.options.rotate,
      canRotate: typeof m.setBearing === 'function',
      hasZoomControl: !!document.querySelector('.leaflet-control-zoom'),
      hasRotateControl: !!document.querySelector('.leaflet-control-rotate, .leaflet-rotate'),
      hasPill: !!document.getElementById('searchAreaPill'),
      hasRecenter: !!document.getElementById('recenterBtn'),
      pillShown: !!document.getElementById('searchAreaPill')?.classList.contains('show'),
      markerCount: document.querySelectorAll('.leaflet-marker-icon').length
    };
  }, null, { polling: 200 }).then(h => h.jsonValue());

  const initial = await readMap();

  // Let the initial render's camera move fully settle (its suppress flag clears
  // ~350ms after fitBounds) before simulating a user pan.
  await page.waitForTimeout(1200);

  // Simulate a user pan through a waitForFunction (main-world access). A plain
  // panBy does NOT set suppressMoveEvent, so moveend should reveal the pill.
  await page.waitForFunction(() => { window.__mapInstance.panBy([700, 500], { animate: true }); return true; }, null, { polling: 100 });
  await page.waitForTimeout(1000);
  const afterPan = await readMap();

  // Click "Search this area".
  await page.click('#searchAreaPill').catch(() => { });
  await page.waitForTimeout(700);
  const afterSearchArea = await readMap();

  // Recenter button.
  await page.click('#recenterBtn').catch(() => { });
  await page.waitForTimeout(700);
  const afterRecenter = await readMap();

  // Rotation still works.
  const rotation = await page.waitForFunction(() => {
    const m = window.__mapInstance;
    const b = m.getBearing();
    m.setBearing(35);
    return { before: b, after: m.getBearing() };
  }, null, { polling: 100 }).then(h => h.jsonValue());

  return { initial, afterPan, afterSearchArea, afterRecenter, rotation };
}
