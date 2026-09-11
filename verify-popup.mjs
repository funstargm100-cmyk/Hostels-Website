// Verify popups behave on a rotated/panned map.
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
  await page.waitForTimeout(1200);

  // Click the first marker to open its popup (real DOM click on the marker icon).
  await page.locator('.leaflet-marker-icon').first().click({ force: true });
  await page.waitForTimeout(900);

  const readPopup = () => page.waitForFunction(() => {
    const m = window.__mapInstance;
    const popupEl = document.querySelector('#mapSearch .leaflet-popup');
    const wrap = document.getElementById('mapSearch').getBoundingClientRect();
    let info = { open: !!(m._popup && m._popup.isOpen()), inView: false, markerCount: document.querySelectorAll('#mapSearch .leaflet-marker-icon').length, mapBusy: window.__mapBusy };
    if (popupEl) {
      const r = popupEl.getBoundingClientRect();
      info.rect = { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
      // Popup must be fully inside the map container.
      info.inView = r.left >= wrap.left - 1 && r.right <= wrap.right + 1 && r.top >= wrap.top - 1 && r.bottom <= wrap.bottom + 1;
    }
    // Distance from the popup's anchor/tip to the marker it belongs to.
    const anchor = document.querySelector('#mapSearch .leaflet-popup-tip-container');
    const marker = document.querySelector('#mapSearch .leaflet-marker-icon');
    if (anchor && marker) {
      const a = anchor.getBoundingClientRect(), k = marker.getBoundingClientRect();
      info.tipToMarkerPx = Math.round(Math.hypot((a.left + a.width / 2) - (k.left + k.width / 2), (a.top + a.height / 2) - (k.top + k.height / 2)));
    }
    return info;
  }, null, { polling: 150 }).then(h => h.jsonValue());

  const opened = await readPopup();

  // Rotate the map with a popup open — popup must stay anchored and on-screen.
  await page.waitForFunction(() => { window.__mapInstance.setBearing(60); return true; }, null, { polling: 100 });
  await page.waitForTimeout(700);
  const afterRotate = await readPopup();

  // Pan (drag) with popup open — popup must stay glued to its marker.
  await page.waitForFunction(() => { window.__mapInstance.panBy([220, 140], { animate: true }); return true; }, null, { polling: 100 });
  await page.waitForTimeout(800);
  const afterPan = await readPopup();

  // Close, then re-open by clicking a marker while the map is idle.
  await page.waitForFunction(() => { const m = window.__mapInstance; if (m._popup) m.closePopup(); return true; }, null, { polling: 100 });
  await page.waitForTimeout(400);
  const closedState = await readPopup();
  // Click the marker element directly via its DOM node (dispatch a real click).
  await page.waitForFunction(() => {
    const el = document.querySelector('#mapSearch .leaflet-marker-icon');
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, null, { polling: 100 });
  await page.waitForTimeout(900);
  const reopened = await readPopup();

  // Reset to a clean, unrotated view centred on the pin with its popup open, so a
  // screenshot shows the popup sitting on its marker the way a user sees it.
  await page.waitForFunction(() => {
    const m = window.__mapInstance;
    m.setBearing(0);
    // Centre exactly on the SECOND listing pin, then open its popup.
    m.setView([5.63, -0.16], 16, { animate: false });
    const els = document.querySelectorAll('#mapSearch .leaflet-marker-icon');
    if (els[1]) els[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, null, { polling: 100 });
  await page.waitForTimeout(900);

  return { opened, afterRotate, afterPan, reopened };
}
