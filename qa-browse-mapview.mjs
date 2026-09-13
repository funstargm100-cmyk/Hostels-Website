// QA: switch the browse page into map view and confirm room pins + base render.
export default async function run(page, ui) {
  await page.waitForSelector('#listingsGrid .card', { timeout: 20000 }).catch(() => { });
  // Click "Map" view.
  await page.click('#mapViewBtn');
  await page.waitForSelector('#mapSearch .leaflet-container', { timeout: 20000 }).catch(() => { });
  await page.waitForTimeout(3500);
  return await page.evaluate(() => {
    const map = document.getElementById('mapSearch');
    return {
      mapVisible: document.getElementById('mapWrap').style.display !== 'none',
      pins: map ? map.querySelectorAll('.leaflet-marker-icon').length : 0,
      baseMarkers: map ? map.querySelectorAll('.map-base-marker').length : 0,
      baseLoc: window.__userBaseLoc || null,
    };
  });
}
