// QA: the detail map must OPEN zoomed-out over Sunyani, then fly in to the room.
export default async function run(page, ui) {
  await page.waitForFunction(() => !!window.__detailMap, null, { timeout: 20000 }).catch(() => { });

  const sample = async () => page.evaluate(() => {
    const m = window.__detailMap;
    if (!m) return null;
    const c = m.getCenter();
    return { lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), zoom: +m.getZoom().toFixed(2) };
  });

  const early = await sample();
  await page.waitForTimeout(1000);
  const mid = await sample();
  await page.waitForTimeout(3200);
  const late = await sample();

  const zoomedOutToStart = !!(early && early.zoom <= 7);
  const flewIn = !!(early && late && late.zoom > early.zoom);
  return { early, mid, late, zoomedOutToStart, flewIn };
}
