// QA: wait for the map to finish, then screenshot it (returns nothing heavy).
export default async function run(page) {
  await page.waitForSelector('#detail-map .leaflet-marker-icon', { timeout: 25000 }).catch(() => { });
  // Let the intro fly-in play out fully.
  await page.waitForTimeout(4000);
  const box = await page.locator('#detail-map').boundingBox().catch(() => null);
  if (box) {
    await page.screenshot({ path: 'qa-flyin-final.png', clip: box });
  }
  return { clipped: !!box };
}
