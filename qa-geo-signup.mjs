yesexport default async function run(page, ui) {
  const out = {};
  await page.evaluate(() => document.querySelector('.su-role-card[data-role="seeker"]').click());
  await page.waitForSelector('#suMap', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000);

  // popular chips rendered?
  out.chipCount = await page.locator('.su-chip').count();

  // click the UENR chip
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.su-chip')].find(c => c.textContent.includes('UENR'));
    if (chip) chip.click(); else throw new Error('no UENR chip');
  });
  await page.waitForTimeout(2500);
  out.pinAfterChip = await page.locator('#suPinStatus').innerText();
  out.latAfterChip = await page.locator('#suBaseLat').inputValue();
  await page.screenshot({ path: 'signup-search-chip.png' });

  // type in the search box for autocomplete
  await page.fill('#suPlaceSearch', 'KNUST');
  await page.waitForTimeout(2000);
  out.suggestionCount = await page.locator('.su-search-item').count();
  out.firstSuggestion = await page.locator('.su-search-item').first().innerText().catch(() => 'none');
  await page.screenshot({ path: 'signup-search-suggest.png' });

  // pick first suggestion
  await page.evaluate(() => document.querySelector('.su-search-item:not(.muted)').click());
  await page.waitForTimeout(1200);
  out.pinAfterSearch = await page.locator('#suPinStatus').innerText();
  out.lngAfterSearch = await page.locator('#suBaseLng').inputValue();

  return out;
}
