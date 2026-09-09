export default async function run(page, ui) {
  await page.waitForSelector('#listingsGrid .card', { timeout: 20000 });
  // wait until every image is either loaded or errored
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('#listingsGrid .card img')];
    return imgs.length && imgs.every(i => i.complete);
  }, { timeout: 30000 }).catch(() => 'timeout waiting images');
  const imgs = await page.evaluate(() => [...document.querySelectorAll('#listingsGrid .card img')].map(i => ({
    src: i.src.replace('data:image', 'DATAURI').slice(0, 100),
    ok: i.naturalWidth > 0
  })));
  await page.screenshot({ path: 'listings-loaded.png', fullPage: false });
  const grid = await page.evaluate(() => {
    const g = document.getElementById('listingsGrid');
    const cs = getComputedStyle(g);
    return { display: cs.display, cols: cs.gridTemplateColumns, cards: g.children.length, cls: g.className };
  });
  return { imgs, grid };
}
