// QA: detail page distance line must show BOTH walking and driving time.
export default async function run(page, ui) {
  await page.waitForSelector('#detail-map .leaflet-marker-icon', { timeout: 20000 }).catch(() => { });
  await page.waitForTimeout(2500);
  return await page.evaluate(() => {
    const textEl = document.getElementById('distanceText');
    const resultEl = document.getElementById('distanceResult');
    return {
      visible: resultEl ? resultEl.style.display !== 'none' : null,
      text: textEl ? textEl.innerText.trim() : null,
    };
  });
}
