// Empty search/filter in map view: markers cleared + "No results" notice shown
export default async function run(page) {
  const read = () => page.evaluate(() => ({
    count: (document.getElementById('resultsCount')?.textContent || '').trim(),
    markers: document.querySelectorAll('#mapSearch .leaflet-marker-icon').length,
    empty: document.getElementById('mapEmptyState')?.style.display,
    emptyText: (document.getElementById('mapEmptyState')?.innerText || '').trim().slice(0, 60)
  }));
  const out = {};
  await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
  await page.click('#mapViewBtn');
  await page.waitForTimeout(4500);
  out.map = await read();

  // Filter to a price that matches nothing
  await page.fill('#maxPrice', '10');
  await page.click('#filtersPanel button.btn-primary');
  await page.waitForTimeout(2500);
  out.afterEmptyFilter = await read();

  // Clear filters -> results and pins return, notice hides
  await page.click('#mobileFilterBtn').catch(() => { });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#filtersPanel button')];
    btns.find(b => b.textContent.trim() === 'Clear')?.click();
  });
  await page.waitForTimeout(2500);
  out.afterClear = await read();
  return out;
}
