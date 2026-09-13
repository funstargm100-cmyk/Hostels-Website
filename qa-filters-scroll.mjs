// QA: the browse Filters sidebar scrolls independently of the page.
import { chromium } from 'playwright';

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

const out = {};
try {
  await page.goto('http://localhost:3000/listings', { waitUntil: 'load' });
  await page.waitForSelector('#filtersPanel', { timeout: 15000 });
  await page.waitForSelector('#listingsGrid .card', { timeout: 15000 }).catch(() => { });
  await page.waitForTimeout(1200);

  // Panel geometry vs viewport.
  out.panel = await page.evaluate(() => {
    const p = document.getElementById('filtersPanel');
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    const scroll = p.querySelector('.filters-scroll');
    return {
      panelHeight: Math.round(r.height),
      viewportH: window.innerHeight,
      bounded: r.height <= window.innerHeight,          // capped to viewport
      display: cs.display,
      overflow: cs.overflow,
      hasScrollRegion: !!scroll,
      scrollOverflowY: scroll ? getComputedStyle(scroll).overflowY : null,
      scrollHasOverflow: scroll ? scroll.scrollHeight > scroll.clientHeight + 1 : null,
    };
  });

  // Scrolling INSIDE the filter area must scroll only the panel, not the page.
  const before = await page.evaluate(() => ({ pageY: window.scrollY, panelScroll: document.querySelector('.filters-scroll').scrollTop }));
  await page.evaluate(() => { document.querySelector('.filters-scroll').scrollTop = 120; });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ pageY: window.scrollY, panelScroll: document.querySelector('.filters-scroll').scrollTop }));
  out.scrollTest = {
    pageStayedStill: before.pageY === after.pageY,
    panelScrolled: after.panelScroll > before.panelScroll
  };

  // Header + action bar must stay inside the panel's box (not scrolled away).
  out.pinned = await page.evaluate(() => {
    const p = document.getElementById('filtersPanel').getBoundingClientRect();
    const head = document.querySelector('.filters-head').getBoundingClientRect();
    const actions = document.querySelector('.filters-actions').getBoundingClientRect();
    return {
      headVisible: head.top >= p.top - 1 && head.bottom <= p.bottom + 1,
      actionsVisible: actions.bottom <= p.bottom + 1 && actions.top >= p.top - 1,
    };
  });

  // Mobile: the drawer still opens and scrolls.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  out.mobilePanel = await page.evaluate(() => {
    const p = document.getElementById('filtersPanel');
    const cs = getComputedStyle(p);
    return { visible: cs.display !== 'none', position: cs.position };
  });
  if (out.mobilePanel.visible) {
    await page.evaluate(() => { const p = document.getElementById('filtersPanel'); p.classList.add('open'); });
    await page.waitForTimeout(500);
    out.mobileOpen = await page.evaluate(() => {
      const p = document.getElementById('filtersPanel');
      const r = p.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width), canScroll: p.scrollHeight >= p.clientHeight };
    });
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'qa-filters-scroll.png' });
  out.screenshot = 'qa-filters-scroll.png';

  console.log(JSON.stringify(out, null, 2));
} finally {
  await b.close();
}
