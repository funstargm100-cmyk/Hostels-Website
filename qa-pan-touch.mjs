import { chromium } from 'playwright';

const b = await chromium.launch();

// Emulate a touch device so the plugin takes its touch code paths.
const ctx = await b.newContext({
  viewport: { width: 390, height: 780 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });

await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#loginIdentifier, #loginEmail', { timeout: 20000 });
await page.fill('#loginIdentifier, #loginEmail', 'seeker@test.com');
await page.fill('#loginPassword', 'password123');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
  page.click('#loginForm button[type="submit"]')
]);

await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#listingsGrid .card', { timeout: 30000 });
await page.waitForFunction(() => !!window.__userBaseLoc, null, { timeout: 15000 });
await page.click('#mapViewBtn');
await page.waitForSelector('.leaflet-marker-icon', { timeout: 20000 });
await page.waitForTimeout(2500);

const box = await page.locator('#mapSearch').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

const before = await page.evaluate(() => { const c = window.__mapInstance.getCenter(); return { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) }; });

// ONE-FINGER touch drag — panning is now EXCLUDED, so the center must NOT move.
await page.touchscreen.tap(cx, cy).catch(() => { });
await page.waitForTimeout(300);

// Playwright's touchscreen has no drag API, so dispatch real touch events.
const after = await page.evaluate(async ([cx, cy]) => {
  const el = document.querySelector('#mapSearch');
  const mk = (type, x, y) => {
    const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
    return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] });
  };
  el.dispatchEvent(mk('touchstart', cx, cy));
  await new Promise(r => setTimeout(r, 60));
  el.dispatchEvent(mk('touchmove', cx + 40, cy + 20));
  await new Promise(r => setTimeout(r, 60));
  el.dispatchEvent(mk('touchmove', cx + 100, cy + 60));
  await new Promise(r => setTimeout(r, 60));
  el.dispatchEvent(mk('touchend', cx + 100, cy + 60));
  await new Promise(r => setTimeout(r, 600));
  const c = window.__mapInstance.getCenter();
  return { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) };
}, [cx, cy]);

const touchOut = {
  before, after,
  // Pan is intentionally disabled: a one-finger drag must leave the map put.
  touchPanMoved: before.lat !== after.lat || before.lng !== after.lng,
  touchPanExcluded: before.lat === after.lat && before.lng === after.lng
};

// Does the container carry the touch classes Leaflet needs?
touchOut.containerTouchClasses = await page.evaluate(() => document.querySelector('#mapSearch').className);

// Is the rotate plugin's own drag handler swallowing the single-finger drag?
touchOut.handlers = await page.evaluate(() => {
  const m = window.__mapInstance;
  return {
    // Expect FALSE — map-surface panning is turned off.
    draggingEnabled: m.dragging?.enabled(),
    touchRotate: m.options.touchRotate,
    rotate: m.options.rotate,
    scrollWheelZoom: m.options.scrollWheelZoom,
    touchZoom: m.options.touchZoom,
    // rotation gestures must still be wired up, pan removed or not
    hasRotateHandler: !!m._rotate,
    canRotate: typeof m.setBearing === 'function',
    dragHandlerTypes: Object.values(m._handlers || {}).map(h => h?.constructor?.name)
  };
});

console.log(JSON.stringify(touchOut, null, 2));
await page.screenshot({ path: 'pan-touch.png' });
await b.close();
