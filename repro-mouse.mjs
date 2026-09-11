// Reproduce: mouse click on a marker after pan + rotate.
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

  const state = () => page.waitForFunction(() => ({
    open: !!(window.__mapInstance._popup && window.__mapInstance._popup.isOpen()),
    bearing: Math.round(window.__mapInstance.getBearing()),
    center: (() => { const c = window.__mapInstance.getCenter(); return { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) }; })()
  }), null, { polling: 100 }).then(h => h.jsonValue());

  // Rotate the map, then pan it.
  await page.waitForFunction(() => { window.__mapInstance.setBearing(45); return true; }, null, { polling: 100 });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => { window.__mapInstance.panBy([120, 80], { animate: true }); return true; }, null, { polling: 100 });
  await page.waitForTimeout(900);

  const before = await state();

  // Re-locate the marker icon immediately before each click: opening a popup can
  // nudge the camera (ensurePopupVisible), which moves the pin, so a coordinate
  // captured once would no longer be over it.
  const iconBox = async () => page.locator('#mapSearch .leaflet-marker-icon').first().boundingBox();
  const closePopup = () => page.waitForFunction(() => { const m = window.__mapInstance; if (m._popup) m.closePopup(); return true; }, null, { polling: 100 });

  // (1) Clean click, dead centre.
  let b = await iconBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(700);
  const cleanCentre = await state();

  // (2) A realistic human click: a couple of px of jitter between press and
  // release, which Leaflet's 3px drag tolerance used to swallow.
  await closePopup();
  await page.waitForTimeout(400);
  b = await iconBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 2 + 2, { steps: 3 }); // human jitter
  await page.mouse.up();
  await page.waitForTimeout(700);
  const jittered = await state();

  // (3) Click near the icon's lower-edge (where a user aiming at the visible edge
  // would land on a rotated map).
  await closePopup();
  await page.waitForTimeout(400);
  b = await iconBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 4);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(700);
  const corner = await state();

  // Close any popup, then record where a NATIVE mousedown actually lands during
  // a rotated-map click on the marker icon. If the browser hit-test sees the
  // icon, we can drive the open from the icon's own DOM events, sidestepping
  // Leaflet's rotation-broken hit-testing entirely.
  await page.waitForFunction(() => { const m = window.__mapInstance; if (m._popup) m.closePopup(); return true; }, null, { polling: 100 });
  await page.waitForTimeout(300);

  await page.waitForFunction(() => {
    window.__seen = [];
    const cont = document.getElementById('mapSearch');
    const isIcon = (t) => t && t.classList && t.classList.contains('leaflet-marker-icon');
    cont.addEventListener('mousedown', (e) => window.__seen.push('mousedown:' + (isIcon(e.target) ? 'ICON' : 'map')), { capture: true });
    cont.addEventListener('mouseup', (e) => window.__seen.push('mouseup:' + (isIcon(e.target) ? 'ICON' : 'map')), { capture: true });
    cont.addEventListener('click', (e) => window.__seen.push('click:' + (isIcon(e.target) ? 'ICON' : 'map')), { capture: true });
    return true;
  }, null, { polling: 100 });

  const b3 = await page.locator('#mapSearch .leaflet-marker-icon').first().boundingBox();
  await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2);
  await page.mouse.down();
  await page.mouse.move(b3.x + b3.width / 2 + 3, b3.y + b3.height / 2 + 2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const nativeEventTargets = await page.waitForFunction(() => window.__seen || null, null, { polling: 100 }).then(h => h.jsonValue());

  const probe = await page.waitForFunction(() => ({
    pinLookup: window.__pinLookup || null,
    pinMouseup: window.__pinMouseup || null,
    pinToggleCalled: window.__pinToggleCalled || null
  }), null, { polling: 100 }).then(h => h.jsonValue());

  return {
    before,
    cleanCentre: { opened: cleanCentre.open },
    jittered: { opened: jittered.open },
    corner: { opened: corner.open },
    nativeEventTargets,
    probe
  };
}
