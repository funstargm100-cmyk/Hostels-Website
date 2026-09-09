export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'qa-mobile-top.png' });

  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  const bad = await page.evaluate((vw) => {
    const out = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.left < 4 && r.right > vw - 4 && el.textContent.trim()) {
        const cs = getComputedStyle(el);
        out.push({
          tag: el.tagName,
          cls: (el.className.baseVal !== undefined ? 'svg' : String(el.className)).slice(0, 40),
          text: el.textContent.trim().slice(0, 50),
          left: Math.round(r.left), right: Math.round(r.right),
          padL: cs.paddingLeft, mL: cs.marginLeft
        });
      }
    });
    return out.slice(0, 25);
  }, vw);

  // also capture a mid-page screenshot
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'qa-mobile-mid.png' });

  return { vw, count: bad.length, bad };
}
