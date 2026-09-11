// Final check: mouse clicks open popups after pan/rotate, real drags still pan,
// and popups stay anchored + fully visible.
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
  await page.waitForTimeout(1200);

  const read = () => page.waitForFunction(() => {
    const m = window.__mapInstance;
    const c = m.getCenter();
    const popup = m._popup;
    const el = popup && popup.getElement();
    const cr = document.getElementById('mapSearch').getBoundingClientRect();
    let fullyVisible = null, anchorPx = null;
    if (el && popup.isOpen()) {
      const pr = el.getBoundingClientRect();
      fullyVisible = pr.top >= cr.top - 2 && pr.bottom <= cr.bottom + 2 && pr.left >= cr.left - 2 && pr.right <= cr.right + 2;
      const src = popup._source;
      const tip = document.querySelector('#mapSearch .leaflet-popup-tip-container');
      if (src && src._icon && tip) {
        const tr = tip.getBoundingClientRect(), ir = src._icon.getBoundingClientRect();
        anchorPx = Math.round(Math.hypot((tr.left + tr.width / 2) - (ir.left + ir.width / 2), (tr.top + tr.height / 2) - (ir.top + ir.height / 2)));
      }
    }
    return { open: !!(popup && popup.isOpen()), fullyVisible, anchorPx, center: { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) }, bearing: Math.round(m.getBearing()) };
  }, null, { polling: 120 }).then(h => h.jsonValue());

  const iconBox = () => page.locator('#mapSearch .leaflet-marker-icon').first().boundingBox();
  const closePopup = () => page.waitForFunction(() => { const m = window.__mapInstance; if (m._popup) m.closePopup(); return true; }, null, { polling: 100 });

  // Rotate + pan the map first, the reported trigger.
  await page.waitForFunction(() => { window.__mapInstance.setBearing(40); return true; }, null, { polling: 100 });
  await page.waitForTimeout(400);
  await page.waitForFunction(() => { window.__mapInstance.panBy([100, 70], { animate: true }); return true; }, null, { polling: 100 });
  await page.waitForTimeout(900);
  const afterRotatePan = await read();

  // MOUSE click with a few px of jitter.
  let b = await iconBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 2 + 2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const mouseClickOpens = await read();

  // MOUSE click near the icon edge.
  await closePopup();
  await page.waitForTimeout(400);
  b = await iconBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 4);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(800);
  const mouseEdgeClickOpens = await read();

  // A REAL drag on the map surface must still PAN (not be eaten by the pin logic).
  await closePopup();
  await page.waitForTimeout(300);
  const beforeDrag = await read();
  const mapBox = await page.locator('#mapSearch').boundingBox();
  await page.mouse.move(mapBox.x + 60, mapBox.y + mapBox.height - 60);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + 60 + 160, mapBox.y + mapBox.height - 60 + 100, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterDrag = await read();
  const dragStillPans = beforeDrag.center.lat !== afterDrag.center.lat || beforeDrag.center.lng !== afterDrag.center.lng;

  // TOUCH still opens (dispatch real touch events; the runner context has no
  // touchscreen, and the map takes its touch code path off these events).
  await closePopup();
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const el = document.querySelector('#mapSearch .leaflet-marker-icon');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
    return true;
  }, null, { polling: 100 });
  await page.waitForTimeout(800);
  const touchOpens = await read();

  const dbg = await page.waitForFunction(() => ({ md: window.__md || 0, mdPin: window.__mdPin || 0, mu: window.__mu || null, muFound: window.__muFound }), null, { polling: 100 }).then(h => h.jsonValue());
  return {
    dbg,
    afterRotatePan: { open: afterRotatePan.open, bearing: afterRotatePan.bearing },
    mouseClickOpens: { open: mouseClickOpens.open, fullyVisible: mouseClickOpens.fullyVisible, anchorPx: mouseClickOpens.anchorPx },
    mouseEdgeClickOpens: { open: mouseEdgeClickOpens.open, fullyVisible: mouseEdgeClickOpens.fullyVisible, anchorPx: mouseEdgeClickOpens.anchorPx },
    dragStillPans,
    touchOpens: { open: touchOpens.open }
  };
}
