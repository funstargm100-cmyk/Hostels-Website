export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3000/listings.html', { waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 20000 });
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('#listingsGrid .card img')];
    return imgs.length && imgs.every(i => i.complete);
  }, { timeout: 30000 }).catch(() => 'timeout');
  const grid = await page.evaluate(() => {
    const g = document.getElementById('listingsGrid');
    const card = g.querySelector('.card');
    return {
      cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      cardWidth: Math.round(card.getBoundingClientRect().width),
      vw: document.documentElement.clientWidth
    };
  });
  await page.screenshot({ path: 'listings-mobile.png' });
  return grid;
}
