// 1) Stale area-scope after "Search this area": does a later explicit filter
//    still get constrained to the old viewport?
// 2) Mobile touch: do filters work in map view?
export default async function run(page) {
  const read = () => page.evaluate(() => ({
    count: (document.getElementById('resultsCount')?.textContent || '').trim(),
    markers: document.querySelectorAll('#mapSearch .leaflet-marker-icon').length
  }));
  const out = {};
  await page.setViewportSize({ width: 390, height: 844 }); // mobile
  await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
  await page.click('#mapViewBtn');
  await page.waitForTimeout(4500);
  out.map = await read();

  // Pan, then "Search this area"
  const box = await (await page.$('#mapSearch')).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.touchscreen.tap(cx, cy).catch(() => { });
  await page.waitForTimeout(300);  // drag with mouse fallback (headless touch drag is unreliable)
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx - 180, cy - 120, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(1200);
  out.pillShown = await page.evaluate(() => document.getElementById('searchAreaPill')?.classList.contains('show'));
  await page.click('#searchAreaPill').catch(() => { });
  await page.waitForTimeout(2500);
  out.afterArea = await read();

  // Now apply an explicit filter (max price) — should NOT stay constrained to the panned viewport
  await page.click('#mapFsMenuBtn').catch(() => { });
  await page.waitForTimeout(500);
  await page.fill('#maxPrice', '9999');
  const applied = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#filtersPanel button')];
    const apply = btns.find(b => b.textContent.trim() === 'Apply');
    if (apply) { apply.click(); return true; }
    return false;
  });
  out.applyClicked = applied;
  await page.waitForTimeout(2500);
  out.afterExplicitFilter = await read();
  out.expectedTotal = await page.evaluate(async () => (await (await fetch('/api/listings?max_price=9999&page=1&limit=12')).json()).total);
  return out;
}
