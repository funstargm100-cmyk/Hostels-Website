export default async function run(page, ui) {
  // wait for cards to load
  await page.waitForTimeout(2500);
  const snap = await ui.snapshot();
  const mapBtn = snap.match(/@(e\d+) button[^\n]*map/i)?.[1];
  if (!mapBtn) return { error: 'map toggle not found', snapshot: snap };
  await ui.click(mapBtn);
  await page.waitForTimeout(3500);
  const mapVisible = await page.evaluate(() => {
    const el = document.querySelector('#mapWrap');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, display: getComputedStyle(el).display, w: r.width, h: r.height, canvas: !!el.querySelector('canvas'), tiles: el.querySelectorAll('img').length, markers: el.querySelectorAll('img.leaflet-marker-icon, .roomy-pin, [class*="marker"]').length, popups: el.innerHTML.length };
  });
  const countText = await page.evaluate(() => document.querySelector('#resultCount, [data-count]')?.innerText || document.body.innerText.match(/\d+ rooms?/)?.[0] || '');
  return { mapVisible, countText };
}
