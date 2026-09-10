export default async function run(page, ui) {
  // Login as a seeker
  await page.goto('http://localhost:3000/login');
  await page.fill('#loginIdentifier, #loginEmail', 'seeker@test.com');
  await page.fill('#loginPassword', 'password123');
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/listings'), { timeout: 20000 }).catch(() => null),
    page.click('#loginForm button[type="submit"]')
  ]);

  // Go to browse rooms
  await page.goto('http://localhost:3000/listings');
  await page.waitForSelector('#listingsGrid .room-card, #listingsGrid .empty-state', { timeout: 20000 });
  const count = await page.textContent('#resultsCount');
  const apiStatus = resp ? resp.status() : 'no-response';

  // Switch to map view
  const mapBtn = await ui.snapshot();
  const mapRef = mapBtn.match(/@(e\d+) button[^\n]*Map/)?.[1];
  if (!mapRef) return { count, error: 'Map button not found', snapshot: mapBtn };
  await ui.click(mapRef);
  await page.waitForTimeout(1200);

  const markers = await page.evaluate(() => {
    const map = document.querySelector('#mapSearch');
    return {
      mapVisible: !!map && map.offsetHeight > 0,
      leafletPanes: !!document.querySelector('.leaflet-pane'),
      markerCount: document.querySelectorAll('.leaflet-marker-icon').length
    };
  });
  return { count, apiStatus, ...markers };
}
