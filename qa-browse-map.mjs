// QA: browse page map must still have its full control set + room markers + work.
export default async function run(page, ui) {
  await page.waitForSelector('#mapSearch .leaflet-container', { timeout: 20000 }).catch(() => { });
  await page.waitForTimeout(2500);
  return await page.evaluate(() => {
    const map = document.getElementById('mapSearch');
    const pins = map ? map.querySelectorAll('.leaflet-marker-icon').length : 0;
    const baseMarkers = map ? map.querySelectorAll('.map-base-marker').length : 0;
    return {
      roomPins: pins,
      baseMarkers,
      hasSearchPill: !!document.getElementById('searchAreaPill'),
      hasRecenter: !!document.getElementById('recenterBtn'),
      hasFullscreen: !!document.getElementById('mapFullscreenBtn'),
      hasRotateKnob: !!document.getElementById('mapRotateKnob'),
      hasPopupMode: !!document.getElementById('mapPopupModeBtn'),
      baseLoc: window.__userBaseLoc || null,
    };
  });
}
