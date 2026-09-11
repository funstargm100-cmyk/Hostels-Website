import { chromium } from 'playwright';

// Real touch device: verify a TAP on a marker still opens its popup (the mouse
// fix must not have regressed touch).
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 390, height: 780 },
  hasTouch: true, isMobile: true, deviceScaleFactor: 3
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });

page.route('**/api/**', (route) => {
  const url = route.request().url();
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (url.includes('/api/auth/me')) return json({ user: { role: 'seeker', base_lat: 5.60, base_lng: -0.19 } });
  if (url.includes('/api/listings')) return json({
    listings: [
      {
        uuid: 'a', title: 'Room A', location_area: 'Accra', price_per_head: 900, occupancy_type: 1,
        display_lat: 5.6037, display_lng: -0.187, location_lat: 5.6037, location_lng: -0.187
      },
      {
        uuid: 'b', title: 'Room B', location_area: 'Accra', price_per_head: 1200, occupancy_type: 2,
        display_lat: 5.63, display_lng: -0.16, location_lat: 5.63, location_lng: -0.16
      }
    ], total: 2
  });
  return json({});
});

await ctx.addInitScript(() => {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ name: 'Seeker', role: 'seeker' }));
});

await page.addInitScript(() => {
  window.__docTouch = { start: 0, end: 0, click: 0, pointerdown: 0 };
  document.addEventListener('touchstart', () => { window.__docTouch.start++; }, true);
  document.addEventListener('touchend', () => { window.__docTouch.end++; }, true);
  document.addEventListener('click', () => { window.__docTouch.click++; }, true);
  document.addEventListener('pointerdown', () => { window.__docTouch.pointerdown++; }, true);
});

await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#listingsGrid .card', { timeout: 30000 });
await page.click('#mapViewBtn');
await page.waitForFunction(() => !!window.__mapInstance, null, { timeout: 20000 });
await page.waitForTimeout(1500);

// Rotate + pan first, exactly the reported trigger.
await page.evaluate(() => { window.__mapInstance.setBearing(40); });
await page.waitForTimeout(400);
await page.evaluate(() => { window.__mapInstance.panBy([100, 70], { animate: true }); });
await page.waitForTimeout(900);

// Pick a marker that is actually ON-SCREEN (rotate/pan can push pins to an edge).
const vp = page.viewportSize();
let box = null;
for (const b of await page.locator('#mapSearch .leaflet-marker-icon').all()) {
  const bb = await b.boundingBox();
  if (bb && bb.x > 0 && bb.y > 0 && bb.x + bb.width < vp.width && bb.y + bb.height < vp.height) { box = bb; break; }
}
if (!box) { console.log(JSON.stringify({ error: 'no on-screen marker' })); await b.close(); process.exit(0); }
console.log('tapAt', Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), 'viewport', vp);

// TAP the marker (real touch).
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(900);

const afterTap = await page.evaluate(() => {
  const m = window.__mapInstance;
  const popup = m._popup;
  const el = popup && popup.getElement();
  const cr = document.getElementById('mapSearch').getBoundingClientRect();
  let fullyVisible = null, anchorPx = null;
  if (el && popup.isOpen()) {
    const pr = el.getBoundingClientRect();
    fullyVisible = pr.top >= cr.top - 2 && pr.bottom <= cr.bottom + 2;
    const src = popup._source;
    const tip = document.querySelector('#mapSearch .leaflet-popup-tip-container');
    if (src && src._icon && tip) {
      const tr = tip.getBoundingClientRect(), ir = src._icon.getBoundingClientRect();
      anchorPx = Math.round(Math.hypot((tr.left + tr.width / 2) - (ir.left + ir.width / 2), (tr.top + tr.height / 2) - (ir.top + ir.height / 2)));
    }
  }
  return { open: !!(popup && popup.isOpen()), tapSeen: window.__tapSeen || 0, mapTapSet: !!window.__mapTap, bootStart: window.__bootTouchStart || 0, bootEnd: window.__bootTouchEnd, bootTarget: window.__bootTarget, bootEfp: window.__bootEfp, bootEfpParent: window.__bootEfpParent, bootPt: window.__bootPt };
});

console.log(JSON.stringify({ afterRotatePanTap: afterTap }, null, 2));
await page.screenshot({ path: 'touch-popup.png' });
await b.close();
