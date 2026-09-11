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

// Rotate first, then find the pin that traces — via the app's own marker objects,
// so we are not guessing at DOM order.
await page.evaluate(() => window.__mapInstance.setBearing(35));
await page.waitForTimeout(700);

const result = await page.evaluate(async () => {
  const m = window.__mapInstance;
  // Pull every marker out of the marker layer and open the one nearest the base.
  const layers = Object.values(m._layers).filter(l => l instanceof L.Marker);
  const base = window.__userBaseLoc;
  let best = null;
  for (const mk of layers) {
    if (!mk.__listingLatLng) continue;
    const d = base ? mk.__listingLatLng.distanceTo(L.latLng(base.lat, base.lng)) : Infinity;
    if (!best || d < best.d) best = { mk, d };
  }
  if (!best) return { error: 'no markers' };
  best.mk.openPopup();
  await new Promise(r => setTimeout(r, 3500));
  const overlay = document.querySelector('#mapSearch .leaflet-overlay-pane');
  const road = overlay ? [...overlay.querySelectorAll('path')].find(p => p.getAttribute('stroke') === '#0e7490') : null;
  return {
    clickedTitle: best.mk.__listingTitle,
    distKm: +(best.d / 1000).toFixed(2),
    popupOpen: !!document.querySelector('.leaflet-popup-content .card'),
    popupTitle: document.querySelector('.leaflet-popup-content .card-title')?.textContent?.trim(),
    amenitiesHidden: !document.querySelector('.leaflet-popup-content .amenity-icons'),
    traceDrawn: !!road,
    bearing: m.getBearing()
  };
});
console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: 'rotate-final.png' });
await b.close();
