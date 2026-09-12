// Repro: do filter & search work in FULLSCREEN map mode?
export default async function run(page) {
  const read = () => page.evaluate(() => ({
    count: (document.getElementById('resultsCount')?.textContent || '').trim(),
    markers: document.querySelectorAll('#mapSearch .leaflet-marker-icon').length,
    fullscreen: document.getElementById('mapWrap')?.classList.contains('map-fullscreen-on'),
    panelOpen: document.getElementById('filtersPanel')?.classList.contains('open'),
    panelVisible: (() => {
      const p = document.getElementById('filtersPanel');
      if (!p) return false;
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    })(),
    panelRect: (() => { const r = document.getElementById('filtersPanel')?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; })(),
    panelZ: (() => { const p = document.getElementById('filtersPanel'); return p ? getComputedStyle(p).zIndex : null; })(),
    wrapZ: (() => { const w = document.getElementById('mapWrap'); return w ? getComputedStyle(w).zIndex : null; })()
  }));
  const out = {};
  await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
  await page.click('#viewMapBtn').catch(async () => { await page.getByRole('button', { name: /map/i }).first().click(); });
  await page.waitForTimeout(4000);
  out.map = await read();

  // Enter fullscreen
  await page.click('#mapFullscreenBtn');
  await page.waitForTimeout(1500);
  out.fullscreen = await read();

  // Open the hamburger filters sidebar
  await page.click('#mapFsMenuBtn');
  await page.waitForTimeout(600);
  out.sidebarOpen = await read();

  // Apply a price filter from the sidebar
  const priceInput = await page.$('#maxPrice');
  if (priceInput) {
    await page.fill('#maxPrice', '9999');
    await page.click('#filtersPanel button.btn-primary').catch(() => { });
    await page.waitForTimeout(2500);
    out.afterFilter = await read();
  } else out.afterFilter = 'no #maxPrice';

  return out;
}
