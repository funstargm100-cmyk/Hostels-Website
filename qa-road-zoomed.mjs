import { chromium } from 'playwright';

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 850 } });
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

// Find the pin that actually produces a road trace, then fit to it and capture.
let done = false;
const total = await page.locator('.leaflet-marker-icon').count();
for (let i = 0; i < total && !done; i++) {
  await page.evaluate((idx) => {
    const cb = document.querySelector('.leaflet-popup-close-button');
    if (cb) cb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    document.querySelectorAll('.leaflet-marker-icon')[idx]
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }, i);
  await page.waitForTimeout(2500);

  // Zoom the map to fit exactly around the road trace, so both endpoints are on
  // screen at a readable zoom.
  await page.evaluate(() => {
    const overlay = document.querySelector('#mapSearch .leaflet-overlay-pane');
    const road = [...overlay.querySelectorAll('path')].find(p => p.getAttribute('stroke') === '#0e7490');
    if (!road || !window.__mapInstance) return;
    const layer = Object.values(window.__mapInstance._layers).find(l => l._path === road);
    if (layer) window.__mapInstance.fitBounds(layer.getBounds().pad(0.8), { maxZoom: 16 });
  });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const overlay = document.querySelector('#mapSearch .leaflet-overlay-pane');
    const road = [...overlay.querySelectorAll('path')].find(p => p.getAttribute('stroke') === '#0e7490');
    return {
      title: document.querySelector('.leaflet-popup-content .card-title')?.textContent?.trim(),
      roadVerts: road ? ((road.getAttribute('d') || '').match(/L/g) || []).length + 1 : 0,
      roadScreenLen: road ? Math.round(road.getTotalLength()) : 0
    };
  });
  if (r.roadVerts > 3) {
    console.log(JSON.stringify(r, null, 2));
    await page.screenshot({ path: 'road-zoomed.png' });
    done = true;
  }
}
if (!done) console.log('no road trace pin found');
await b.close();
