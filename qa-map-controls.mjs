// Verify the right-rail control stack order + compass knob
export default async function run(page) {
  const out = {};
  await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 });
  await page.click('#mapViewBtn');
  await page.waitForTimeout(4500);
  out.controls = await page.evaluate(() => {
    const ids = ['recenterBtn', 'mapFullscreenBtn', 'mapPopupModeBtn', 'mapRotateKnob'];
    return ids.map(id => {
      const el = document.getElementById(id);
      if (!el) return { id, missing: true };
      const r = el.getBoundingClientRect();
      const wrap = document.getElementById('mapWrap').getBoundingClientRect();
      return { id, x: Math.round(r.x - wrap.x), bottom: Math.round(r.bottom - wrap.bottom), w: Math.round(r.width) };
    });
  });
  out.knobIcon = await page.evaluate(() => {
    const k = document.getElementById('mapRotateKnob');
    return { svg: k?.querySelector('svg')?.getAttribute('class') || '', hasIcon: !!k?.querySelector('svg') };
  });
  out.hint = await page.evaluate(() => {
    const h = document.querySelector('#mapWrap .map-hint');
    const r = h?.getBoundingClientRect();
    const wrap = document.getElementById('mapWrap').getBoundingClientRect();
    return { text: h?.textContent.slice(0, 60), left: Math.round(r.x - wrap.x), bottom: Math.round(r.bottom - wrap.bottom) };
  });
  await page.screenshot({ path: 'map-controls.png' });
  return out;
}
