// Verify the bottom-left pan/rotate knob and the fullscreen hamburger filter menu.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
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

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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
  await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#listingsGrid .card', { timeout: 30000 });
  await page.click('#mapViewBtn');
  await page.waitForFunction(() => !!window.__mapInstance, null, { timeout: 20000 });
  await page.waitForTimeout(800);

  const state = () => page.evaluate(() => {
    const m = window.__mapInstance, k = document.getElementById('mapKnob');
    return {
      hasKnob: !!k,
      knobHasNeedle: !!k && !!k.querySelector('.map-knob-needle'),
      compassGone: !document.querySelector('.leaflet-control-rotate'),
      draggingEnabled: m.dragging && m.dragging.enabled(),
      bearing: Math.round(m.getBearing()),
      center: (() => { const c = m.getCenter(); return [c.lat.toFixed(5), c.lng.toFixed(5)]; })(),
      locked: k ? k.classList.contains('locked') : null
    };
  });

  const initial = await state(); // expect unlocked, bearing 0, no compass

  // 1) Drag the knob (inside the dial) → pans the map
  const kb = await page.locator('#mapKnob').boundingBox();
  const cx = kb.x + kb.width / 2, cy = kb.y + kb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy - 40, { steps: 6 });
  await page.mouse.up();
  const afterDrag = await state();
  // 2) A quick click (no drag) toggles the lock
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  const afterClick = await state();
  // 3) Click again unlocks
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  const afterUnlock = await state();
  // 4) Rim drag → rotate: move in a clear arc just outside the dial
  const rimR = 40;
  for (const [a0, a1] of [[-30, 50], [50, 130]]) {
    const pt = (deg) => [cx + rimR * Math.cos(deg * Math.PI / 180), cy + rimR * Math.sin(deg * Math.PI / 180)];
    let [px, py] = pt(a0);
    await page.mouse.move(cx, cy); await page.mouse.down(); // press the knob first
    await page.mouse.move(px, py, { steps: 4 });            // drag out past the rim
    for (let a = a0; a <= a1; a += 10) { [px, py] = pt(a); await page.mouse.move(px, py); }
    await page.mouse.up();
  }
  const afterRotate = await state();

  // 5) Hamburger in fullscreen
  await page.click('#mapFullscreenBtn');
  await page.waitForTimeout(500);
  const fsState = await page.evaluate(() => ({
    burgerVisible: getComputedStyle(document.getElementById('mapMenuBtn')).display !== 'none',
    burgerTopLeft: (() => { const r = document.getElementById('mapMenuBtn').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })(),
    panelHiddenBefore: getComputedStyle(document.querySelector('.filters-panel')).display === 'none'
  }));
  await page.click('#mapMenuBtn');
  await page.waitForTimeout(300);
  const menuOpen = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains('map-filters-open'),
    panelVisible: (() => { const r = document.querySelector('.filters-panel').getBoundingClientRect(); return r.width > 100 && getComputedStyle(document.querySelector('.filters-panel')).display !== 'none'; })()
  }));
  await page.click('#mapMenuBtn'); // close
  await page.waitForTimeout(200);
  const menuClosed = await page.evaluate(() => !document.body.classList.contains('map-filters-open'));

  console.log(JSON.stringify({ initial, afterDrag, afterClick, afterUnlock, afterRotate, fsState, menuOpen, menuClosed, pageErrors: errors }, null, 2));
  await b.close();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
