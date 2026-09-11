import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
const token = readFileSync('tmp-token.txt', 'utf8').trim();
await ctx.addInitScript((tok) => { localStorage.setItem('token', tok); localStorage.setItem('user', JSON.stringify({ name: 't', role: 'seeker' })); }, token);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
page.on('request', (r) => { if (r.url().includes('/api/geo/route')) console.log('ROUTE REQ:', r.url().slice(-90)); });
page.on('response', (r) => { if (r.url().includes('/api/geo/route')) console.log('ROUTE RESP:', r.status()); });

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
await page.touchscreen.tap(found.x, found.y);
await page.waitForTimeout(10000);

const res = await page.evaluate(() => {
  const m = window.__mapInstance;
  const overlay = document.querySelectorAll('#mapSearch .leaflet-overlay-pane svg path');
  return {
    overlayPaths: overlay.length,
    userBase: window.__userBaseLoc || null,
    popupContent: (m._popup && m._popup.getElement()) ? m._popup.getElement().textContent.slice(0, 60) : null
  };
});
console.log('RESULT:', JSON.stringify(res, null, 2));
await b.close();
