// Verify: fullscreen at bottom, privacy note visible, rotation doesn't jump
export default async function run(page) {
  const out = {};
  await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
  await page.click('#mapViewBtn');
  await page.waitForTimeout(4500);
  out.rail = await page.evaluate(() => {
    const wrap = document.getElementById('mapWrap').getBoundingClientRect();
    return ['mapFullscreenBtn', 'recenterBtn', 'mapPopupModeBtn', 'mapRotateKnob'].map(id => {
      const r = document.getElementById(id)?.getBoundingClientRect();
      return { id, bottom: Math.round(r.bottom - wrap.bottom) };
    }).sort((a, b) => b.bottom - a.bottom);
  });
  out.privacy = await page.evaluate(() => {
    const el = document.querySelector('#mapWrap .map-privacy-note');
    const r = el?.getBoundingClientRect();
    return { text: el?.textContent.trim(), visible: !!el && r.width > 0 };
  });

  // Drag the rotation knob twice; second drag must NOT jump from leftover travel.
  const knob = await page.$('#mapRotateKnob');
  const b = await knob.boundingBox();
  const cy = b.y + b.height / 2;
  const cx = b.x + b.width / 2;
  const readBearing = () => page.evaluate(() => ({
    pane: document.querySelector('.leaflet-map-pane')?.style.transform || null,
    proxy: document.querySelector('.leaflet-proxy')?.style.transform || null
  }));
  // First drag: move right 150px
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  out.bearingAfterDrag1 = await readBearing();
  // Second drag: only 5px — bearing should move ~1deg, NOT jump by drag1's amount
  await page.mouse.move(cx + 150, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 145, cy, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  out.bearingAfterDrag2 = await readBearing();
  return out;
}
