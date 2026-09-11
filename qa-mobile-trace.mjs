import { chromium } from 'playwright';

// Reproduce on a real TOUCH context: does the base↔room trace line draw when a
// marker popup opens on mobile?
const LISTINGS = [
  {
    uuid: 'a', title: 'Room A', location_area: 'Accra', price_per_head: 900, occupancy_type: 1,
    display_lat: 5.6037, display_lng: -0.187, location_lat: 5.6037, location_lng: -0.187
  },
  {
    uuid: 'b', title: 'Room B', location_area: 'Accra', price_per_head: 1200, occupancy_type: 2,
    display_lat: 5.62, display_lng: -0.17, location_lat: 5.62, location_lng: -0.17
  }
];
// Base ~4km away — a realistic "seeker lives elsewhere" case.
const ME = { user: { role: 'seeker', base_lat: 5.58, base_lng: -0.24 } };
const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

(async () => {

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.route('**/api/**', (route) => {
    const u = route.request().url();
    if (u.includes('/api/auth/me')) return route.fulfill(json(ME));
    if (u.includes('/api/listings')) return route.fulfill(json({ listings: LISTINGS, total: 2 }));
    if (u.includes('/api/geo/route')) return route.fulfill(json({ route: { coords: [[5.60, -0.19], [5.6037, -0.187]] } }));
    return route.fulfill(json({}));
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('token', 't');
    localStorage.setItem('user', JSON.stringify({ name: 'S', role: 'seeker' }));
  });

  await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 30000 });
  await page.click('#mapViewBtn');
  await page.waitForFunction(() => !!window.__mapInstance, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  // Confirm the base location was picked up.
  const base = await page.evaluate(() => window.__userBaseLoc || null);

  // Tap a marker that is on-screen.
  const vp = page.viewportSize();
  let box = null;
  for(const el of await page.locator('#mapSearch .leaflet-marker-icon').all()) {
    const bb = await el.boundingBox();
if (bb && bb.x > 0 && bb.y > 0 && bb.x + bb.width < vp.width && bb.y + bb.height < vp.height) { box = bb; break; }
}
if (!box) { console.log(JSON.stringify({ error: 'no on-screen marker', base })); await b.close(); process.exit(0); }
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1500);

const res = await page.evaluate(() => {
  const m = window.__mapInstance;
  const paths = document.querySelectorAll('#mapSearch path.leaflet-interactive');
  // Where are the trace line's ends on screen, vs the map's own box?
  const cr = document.getElementById('mapSearch').getBoundingClientRect();
  const base = window.__userBaseLoc;
  let baseInside = null, roomInside = null, basePx = null;
  if (base) {
    const p = m.latLngToContainerPoint(L.latLng(base.lat, base.lng));
    basePx = { x: Math.round(p.x), y: Math.round(p.y) };
    baseInside = p.x >= 0 && p.x <= cr.width && p.y >= 0 && p.y <= cr.height;
  }
  return {
    popupOpen: !!(m._popup && m._popup.isOpen()),
    tracePathCount: paths.length,
    mapSize: { w: Math.round(cr.width), h: Math.round(cr.height) },
    basePx, baseInside,
    visiblePins: Array.from(document.querySelectorAll('#mapSearch .leaflet-marker-icon')).map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left - cr.left), y: Math.round(b.top - cr.top) }; })
  };
});
console.log(JSON.stringify({ base, res }, null, 2));
await page.screenshot({ path: 'mobile-trace.png' });
await b.close();
})();
