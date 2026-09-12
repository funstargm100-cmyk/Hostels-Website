// Repro: location filter (sidebar + toolbar sync) in map view
export default async function run(page) {
  const read = () => page.evaluate(() => ({
    count: (document.getElementById('resultsCount')?.textContent || '').trim(),
    markers: document.querySelectorAll('#mapSearch .leaflet-marker-icon').length,
    locVal: document.getElementById('searchLocation')?.value,
    tbVal: document.getElementById('toolbarSearch')?.value
  }));
  const out = {};
  await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
  await page.click('#viewMapBtn').catch(async () => { await page.getByRole('button', { name: /map/i }).first().click(); });
  await page.waitForTimeout(4500);
  out.start = await read();

  // Use the SIDEBAR location field (not toolbar): open filters, type, apply
  await page.click('#mobileFilterBtn').catch(() => { });
  await page.waitForTimeout(400);
  await page.fill('#searchLocation', 'New Town');
  await page.waitForTimeout(600); // sidebar input also syncs toolbar instantly
  out.afterTyping = await read();
  await page.click('#filtersPanel button.btn-primary').catch(() => { });
  await page.waitForTimeout(2500);
  out.afterApply = await read();

  // Then clear filters
  await page.click('#mobileFilterBtn').catch(() => { });
  await page.waitForTimeout(300);
  // click the literal "Clear" button in the filters panel
  const cleared = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#filtersPanel button')];
    const clear = btns.find(b => b.textContent.trim() === 'Clear');
    if (clear) { clear.click(); return true; }
    return false;
  });
  out.clearClicked = cleared;
  await page.waitForTimeout(2500);
  out.afterClear = await read();
  return out;
}
