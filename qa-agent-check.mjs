continuexport default async function run(page, ui) {
  // force bypass-cache reload
  const client = await page.context().newCDPSession(page);
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.search-card-title', { timeout: 10000 });
  const text = await page.locator('.search-card').innerText();
  const cls = await page.locator('.search-card').getAttribute('class');
  await page.screenshot({ path: 'agent-hero.png' });
  return { text, cls };
}
