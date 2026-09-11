import { chromium } from 'playwright';

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 850 } });

await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#loginIdentifier, #loginEmail', { timeout: 20000 });
await page.fill('#loginIdentifier, #loginEmail', 'seeker@test.com');
await page.fill('#loginPassword', 'password123');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
  page.click('#loginForm button[type="submit"]')
]);

const token = await page.evaluate(() => localStorage.getItem('token'));
const raw = await page.evaluate(async (t) => {
  const res = await fetch('/api/listings?limit=12', { headers: { Authorization: 'Bearer ' + t } });
  const d = await res.json();
  return d.listings.map(l => ({ title: l.title, dispLat: l.display_lat, dispLng: l.display_lng, lat: l.location_lat, lng: l.location_lng }));
}, token);

const me = await page.evaluate(async (t) => {
  const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t } });
  const d = await res.json();
  return { baseLat: d.user?.base_lat, baseLng: d.user?.base_lng };
}, token);

console.log('BASE:', JSON.stringify(me));
console.log('LISTINGS:');
for (const l of raw) {
  const d = (me.baseLat && l.lat) ? (Math.hypot((l.lat - me.baseLat) * 111, (l.lng - me.baseLng) * 111)).toFixed(2) : '?';
  console.log(`  ${l.title.padEnd(12)} disp=(${l.dispLat},${l.dispLng}) real=(${l.lat},${l.lng}) ~${d}km from base`);
}
await b.close();
