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

let res = null;
const diag = await page.evaluate(() => {
  return {
    baseLoc: window.__userBaseLoc,
    markerCount: Object.values(window.__mapInstance?._layers || {}).filter(l => l.__listingLatLng).length,
    layers: Object.keys(window.__mapInstance?._layers || {}).length
  };
});
console.log('DIAG:', JSON.stringify(diag, null, 2));

// Click marker using real DOM element click like qa-road-zoomed.mjs
const markerEls = await page.locator('.leaflet-marker-icon').all();
console.log('MARKER_ELS:', markerEls.length);
if (markerEls.length > 0) {
  await markerEls[0].click({ force: true });
}
await page.waitForTimeout(3500);

res = await page.evaluate(() => {
  const overlay = document.querySelector('#mapSearch .leaflet-overlay-pane');
  const allPaths = overlay ? Array.from(overlay.querySelectorAll('path')).map(p => ({
    cls: p.getAttribute('class'),
    stroke: p.getAttribute('stroke')
  })) : [];
  const animatedPaths = overlay ? overlay.querySelectorAll('path.trace-line-animated') : [];
  const glowPaths = overlay ? overlay.querySelectorAll('path.trace-line-glow') : [];
  const arrowMarkers = document.querySelectorAll('.trace-arrow');
  const beaconMarkers = document.querySelectorAll('.trace-beacon-outer');
  return {
    allPaths,
    animatedPathCount: animatedPaths.length,
    glowPathCount: glowPaths.length,
    arrowCount: arrowMarkers.length,
    beaconCount: beaconMarkers.length
  };
});

// Log listings coords
const coordsInfo = await page.evaluate(() => {
  return Object.values(window.__mapInstance?._layers || {})
    .filter(l => l.__listingLatLng)
    .map(l => ({ lat: l.__listingLatLng.lat, lng: l.__listingLatLng.lng, base: window.__userBaseLoc }));
});
console.log('LISTINGS_COORDS:', JSON.stringify(coordsInfo, null, 2));

// Zoom in directly to the base and the clicked marker so the trace line is huge and prominent
await page.evaluate(() => {
  const base = window.__userBaseLoc;
  if (!base || !window.__mapInstance) return;
  window.__mapInstance.setView([base.lat, base.lng], 16);
});
await page.waitForTimeout(2000);

console.log('TRACE_VERIFICATION:', JSON.stringify(res, null, 2));
await page.screenshot({ path: 'glow-trace-verify.png' });
await b.close();
