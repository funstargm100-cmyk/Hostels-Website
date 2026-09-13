// QA: detail-page map must show ONLY this room's marker + base marker, no popups,
// and an auto-computed distance line.
export default async function run(page, ui) {
  await page.waitForSelector('#detail-map .leaflet-container', { timeout: 20000 }).catch(() => { });
  // Give the route + trace a moment to land.
  await page.waitForTimeout(2500);

  return await page.evaluate(() => {
    const map = document.querySelector('#detail-map');
    const hasLeaflet = !!(map && map.querySelector('.leaflet-container'));
    // Count Leaflet markers: divIcon base marker + default teardrop room pin.
    const markerIcons = map ? map.querySelectorAll('.leaflet-marker-icon') : [];
    const baseMarkers = map ? map.querySelectorAll('.map-base-marker') : [];
    const openPopups = document.querySelectorAll('#detail-map .leaflet-popup').length;
    const tracePaths = map ? map.querySelectorAll('#detail-map path.map-trace-flow, #detail-map path.map-trace-glow').length : 0;
    const polylines = map ? map.querySelectorAll('#detail-map .leaflet-overlay-pane path').length : 0;
    const distEl = document.getElementById('distanceResult');
    const distText = document.getElementById('distanceText');
    const emptyEl = map ? map.querySelector('.detail-map-empty') : null;
    return {
      hasLeaflet,
      markerIconCount: markerIcons.length,
      baseMarkerCount: baseMarkers.length,
      openPopupCount: openPopups,
      traceGlowFlowCount: tracePaths,
      overlayPathCount: polylines,
      distanceVisible: distEl ? distEl.style.display !== 'none' : null,
      distanceText: distText ? distText.innerText.trim() : null,
      hasEmptyState: !!emptyEl,
      baseLoc: window.__userBaseLoc || null,
      title: document.title,
    };
  });
}
