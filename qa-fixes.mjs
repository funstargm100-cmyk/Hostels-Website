export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 });
  // 1) Listings grid — price vs occupancy tag
  await page.goto('http://localhost:3000/listings.html');
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 }).catch(() => { });
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.scrollWidth);
  const cardInfo = await page.evaluate(() => {
    const f = document.querySelector('#listingsGrid .card .card-footer');
    const p = document.querySelector('#listingsGrid .card .card-price');
    const t = document.querySelector('#listingsGrid .card .tag');
    if (!f || !p || !t) return { found: false };
    const fr = f.getBoundingClientRect(), pr = p.getBoundingClientRect(), tr = t.getBoundingClientRect();
    return { found: true, footerW: Math.round(fr.width), priceRight: Math.round(pr.right), tagLeft: Math.round(tr.left), tagRight: Math.round(tr.right), overlapping: pr.right > tr.left && pr.left < tr.right && pr.bottom > tr.top && pr.top < tr.bottom ? false : (pr.right > tr.left) };
  });
  // 2) filter panel auto-close
  const panelBefore = await page.evaluate(() => {
    document.getElementById('mobileFilterBtn').click();
    return document.getElementById('filtersPanel').classList.contains('open');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.filters-panel .btn-primary')?.click());
  await page.waitForTimeout(500);
  const panelAfterApply = await page.evaluate(() => document.getElementById('filtersPanel').classList.contains('open'));
  await page.evaluate(() => document.getElementById('mobileFilterBtn').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('.filters-panel .btn-outline')?.click());
  await page.waitForTimeout(500);
  const panelAfterClear = await page.evaluate(() => document.getElementById('filtersPanel').classList.contains('open'));
  // 3) detail page
  await page.goto('http://localhost:3000/listing.html?id=1');
  await page.waitForTimeout(3000);
  const detail = await page.evaluate(() => ({
    scrollW: document.body.scrollWidth,
    clientW: document.documentElement.clientWidth,
    mapH: document.getElementById('detail-map')?.getBoundingClientRect().height
  }));
  return { body, cardInfo, panelBefore, panelAfterApply, panelAfterClear, detail };
}
