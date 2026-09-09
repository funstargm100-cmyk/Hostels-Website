export default async function run(page, ui) {
  // Desktop check: toolbar layout
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:3000/listings.html', { waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 20000 });
  await page.screenshot({ path: 'toolbar-desktop.png' });
  const desktop = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.results-toolbar .btn, .view-toggle, #sortSelect')];
    return btns.map(b => b.id || b.className.split(' ')[0]);
  });

  // Type into toolbar search and see results filter
  await page.fill('#toolbarSearch', 'Legon');
  await page.waitForTimeout(900); // debounce + fetch
  const searchResult = await page.evaluate(() => ({
    count: document.getElementById('resultsCount').textContent,
    sidebarValue: document.getElementById('searchLocation').value
  }));

  // Mobile check
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'toolbar-mobile.png' });

  return { desktop, searchResult };
}
