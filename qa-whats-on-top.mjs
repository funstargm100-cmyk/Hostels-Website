// Find what is actually painting over the map during the effect. For each FX
// layer, report its resolved geometry, opacity and painted background — the
// flat pale green field means SOMETHING is near-opaque, and the veil is only .20.
export default async function run(page) {
  await page.goto('http://localhost:3000/listings');
  await page.waitForSelector('#mapViewBtn', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.click('#mapViewBtn');
  await page.waitForSelector('#mapSearch .leaflet-marker-icon', { timeout: 15000 });
  await page.waitForTimeout(6000);

  await page.fill('#toolbarSearch', 'Accra');
  await page.waitForTimeout(400);
  await page.waitForTimeout(450); // mid-effect

  return await page.evaluate(() => {
    const fx = document.getElementById('mapFx');
    const wrap = document.getElementById('mapWrap');
    const mapEl = document.getElementById('mapSearch');
    const out = {
      fxClass: fx.className,
      fxOpacity: getComputedStyle(fx).opacity,
      fxZ: getComputedStyle(fx).zIndex,
      fxBackground: getComputedStyle(fx).backgroundColor,
      fxSize: fx.getBoundingClientRect().width + 'x' + fx.getBoundingClientRect().height,
      // Is the FX layer itself bigger than the map, or offset?
      fxRect: JSON.parse(JSON.stringify(fx.getBoundingClientRect())),
      mapRect: JSON.parse(JSON.stringify(mapEl.getBoundingClientRect())),
      layers: {}
    };

    const sels = ['.map-fx__veil', '.map-fx__rain', '.map-fx__wave', '.map-fx__wave span',
      '.map-fx__bloom', '.map-fx__scanlines', '.map-fx__glitch', '.map-fx__glitch span',
      '.map-fx__sweep', '.map-fx__focus', '.map-fx__hud', '.map-fx__loader'];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out.layers[sel] = 'MISSING'; continue; }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out.layers[sel] = {
        op: Number(cs.opacity).toFixed(2),
        bg: cs.backgroundColor,
        bgImg: cs.backgroundImage.slice(0, 55),
        blend: cs.mixBlendMode,
        filter: cs.filter,
        size: Math.round(r.width) + 'x' + Math.round(r.height)
      };
    }

    // Is anything painting over the map that ISN'T part of our overlay?
    out.overlaySiblings = Array.from(wrap.children).map(c => ({
      id: c.id, cls: c.className,
      op: getComputedStyle(c).opacity,
      z: getComputedStyle(c).zIndex,
      bg: getComputedStyle(c).backgroundColor,
      display: getComputedStyle(c).display
    }));
    return out;
  });
}
