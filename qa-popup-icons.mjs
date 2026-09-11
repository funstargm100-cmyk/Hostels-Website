import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
const token = readFileSync('tmp-token.txt', 'utf8').trim();
await ctx.addInitScript((tok) => { localStorage.setItem('token', tok); }, token);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));

await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => { const g = document.getElementById('listingsGrid'); return g && !g.querySelector('.skeleton-card') && g.querySelector('.card'); }, null, { timeout: 90000 });
await page.click('#mapViewBtn');
await page.waitForFunction(() => !!window.__mapInstance, null, { timeout: 20000 });
await page.waitForTimeout(3000);

const found = await page.evaluate(() => {
  const cr = document.getElementById('mapSearch').getBoundingClientRect();
  const ms = Array.from(document.querySelectorAll('#mapSearch .leaflet-marker-icon')).map(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  return ms.find(m => m.x > cr.x && m.y > cr.y && m.x < cr.x + cr.w - 10 && m.y < cr.y + cr.h - 110) || ms[0] || null;
});
if (!found) { console.log('no on-screen pin'); await b.close(); process.exit(0); }

await page.touchscreen.tap(found.x, found.y);
await page.waitForTimeout(1500);

const r1 = await page.evaluate(() => ({
  iTags: document.querySelectorAll('#mapSearch .leaflet-popup i[data-lucide]').length,
  svgs: document.querySelectorAll('#mapSearch .leaflet-popup svg').length
}));
console.log('before:', JSON.stringify(r1));

await page.evaluate(() => lucide.createIcons());
await page.waitForTimeout(300);
const r2 = await page.evaluate(() => ({
  iTags: document.querySelectorAll('#mapSearch .leaflet-popup i[data-lucide]').length,
  svgs: document.querySelectorAll('#mapSearch .leaflet-popup svg').length
}));
console.log('after plain createIcons:', JSON.stringify(r2));
await b.close();
