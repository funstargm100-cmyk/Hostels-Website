// Verify the listings map: pan EXCLUDED, zoom + rotation kept.
// API is stubbed so the check does not depend on login or the auth rate limiter.
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
    if (url.includes('/api/listings')) return route.fulfill(json({ listings: LISTINGS, total: LISTINGS.length }));
    if (url.includes('/api/auth/me')) return route.fulfill(json(ME));
    return route.fulfill(json({}));
  });
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ name: 'Seeker', role: 'seeker' }));
  });

  await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 30000 });
  await page.click('#mapViewBtn');
  await page.waitForSelector('.leaflet-marker-icon', { timeout: 20000 });
  await page.waitForFunction(() => !!window.__mapInstance, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const out = await page.evaluate(() => {
    const m = window.__mapInstance;
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
      center: { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) }
    };
  });

  const before = out.center;
  const box = await page.locator('#mapSearch').boundingBox();
  if (box) {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 150, cy + 90, { steps: 12 });
    page.mouse.up();
    await page.waitForTimeout(400);
  }
  const after = await page.evaluate(() => {
    const c = window.__mapInstance.getCenter();
    return { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) };
  });

  const rotation = await page.evaluate(() => {
    const m = window.__mapInstance;
    const b = m.getBearing();
    m.setBearing(35);
    return { before: b, after: m.getBearing() };
  });

  out.panExcluded = before.lat === after.lat && before.lng === after.lng;
  out.centerBeforeDrag = before;
  out.centerAfterDrag = after;
  out.rotation = rotation;
  return out;
}
