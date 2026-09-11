export default async function run(page) {
  const out = {};
  // Login as a seeker
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  const idSel = '#loginIdentifier, #loginEmail';
  await page.waitForSelector(idSel, { timeout: 20000 });
  await page.fill(idSel, 'seeker@test.com');
  await page.fill('#loginPassword', 'password123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
    page.click('#loginForm button[type="submit"]')
  ]);
  out.afterLoginUrl = page.url();

  // Go to browse rooms and wait for data
  await page.goto('http://localhost:3000/listings', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('#listingsGrid .card, #listingsGrid .empty-state', { timeout: 30000 });
  } catch (e) {
    out.debug = {
      url: page.url(),
      bodyText: (await page.textContent('body').catch(() => ''))?.slice(0, 500),
      gridHtml: (await page.innerHTML('#listingsGrid').catch(() => ''))?.slice(0, 500)
    };
    return out;
  }
  out.resultsCount = await page.textContent('#resultsCount').catch(() => null);
  out.cardCount = await page.locator('#listingsGrid .card').count();

  // Distance lines rendered on cards?
  out.distanceLines = await page.locator('#listingsGrid .card-distance').count().catch(() => 0);

  // Switch to map view
  const mapBtn = page.locator('#mapViewBtn').first();
  if (await mapBtn.count() === 0) return { ...out, error: 'Map button not found' };
  await mapBtn.click();
  await page.waitForSelector('.leaflet-pane', { timeout: 20000, state: 'attached' });
  await page.waitForTimeout(2000);

  out.map = await page.evaluate(() => {
    const map = document.querySelector('#mapSearch');
    return {
      mapVisible: !!map && map.offsetHeight > 0,
      leafletPanes: !!document.querySelector('.leaflet-pane'),
      markerCount: document.querySelectorAll('.leaflet-marker-icon').length,
      popupSample: document.querySelector('.leaflet-popup-content')?.textContent?.slice(0, 120) || null
    };
  });

  // Click first marker to open popup, verify card + thumbnail + distance
  try {
    await page.evaluate(() => {
      const m = document.querySelectorAll('.leaflet-marker-icon')[0];
      if (!m) throw new Error('no marker');
      m.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForSelector('.leaflet-popup-content', { timeout: 10000 });
    await page.waitForTimeout(1000);
    out.popup = await page.evaluate(() => {
      const el = document.querySelector('.leaflet-popup-content');
      if (!el) return null;
      return {
        hasCard: !!el.querySelector('.card'),
        hasThumb: !!el.querySelector('.card img, .card [style*="background-image"], .card .card-thumb'),
        hasDistance: !!el.querySelector('.card-distance'),
        distanceText: el.querySelector('.card-distance')?.textContent?.trim() || null,
        textSample: el.textContent.trim().slice(0, 150)
      };
    });
  } catch (e) {
    out.popup = { error: String(e).slice(0, 150) };
  }
  return out;
}
