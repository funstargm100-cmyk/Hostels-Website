// QA: per-person = (price + commission + platformFee) / occupancy.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'pf_' + stamp + '@example.com';
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const o = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Price Formula Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '090' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = o.rows[0].id;

  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.waitForSelector('#loginIdentifier', { timeout: 15000 });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 20000 });
    await page.goto('http://localhost:3000/post-ad', { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 40;
      const x = c.getContext('2d'); x.fillStyle = '#345'; x.fillRect(0, 0, 40, 40);
      return c.toDataURL('image/png');
    });
    const buf = Buffer.from(png.split(',')[1], 'base64');
    await page.setInputFiles('#coverInput', { name: 'cover.png', mimeType: 'image/png', buffer: buf });
    await page.setInputFiles('#fileInput', [{ name: 'p1.png', mimeType: 'image/png', buffer: buf }]);
    await page.waitForTimeout(500);
    await page.click('#nextBtn');
    await page.fill('#adTitle', 'QA Formula Room');
    await page.fill('#adDescription', 'QA description for the pricing formula check.');
    await page.click('#nextBtn'); // -> step 3

    await page.selectOption('#adOccupancy', '2'); // 2-in-1
    await page.fill('#adOriginalPrice', '1000');
    await page.waitForTimeout(150);

    const read = () => page.evaluate(() => ({
      perHead: document.getElementById('prevPerHead').textContent,
      total: document.getElementById('prevRoomTotal').textContent,
      commission: document.getElementById('prevCommission').style.display !== 'none' ? document.getElementById('prevCommission').textContent : null,
      taxable: document.getElementById('prevTaxable').style.display !== 'none' ? document.getElementById('prevTaxable').textContent : null,
      feeLabel: document.getElementById('prevFeeLabel').textContent,
      fee: document.getElementById('prevPlatformFee').textContent,
    }));

    out.owner = await read();          // expect perHead 535.00

    await page.click('.poster-type-opt:has(input[value="agent"])');
    await page.waitForTimeout(150);
    await page.selectOption('#adCommissionType', 'percent');
    await page.fill('#adCommission', '10');
    await page.waitForTimeout(150);
    out.agentPercent = await read();   // expect perHead 577.50

    await page.selectOption('#adCommissionType', 'amount');
    await page.fill('#adCommission', '500');
    await page.waitForTimeout(150);
    out.agentFlat = await read();      // expect perHead 787.50

    // Submit as agent flat-500 and verify the persisted row matches the formula.
    await page.click('#nextBtn');      // -> step 4
    await page.click('#nextBtn');      // -> step 5
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      document.getElementById('adLat').value = '7.3400';
      document.getElementById('adLng').value = '-2.3300';
    });
    await page.fill('#adLocationArea', 'QA Area');
    await page.fill('#adLandmark', 'QA Landmark');
    await page.waitForTimeout(200);
    await page.click('#nextBtn');      // -> review
    await page.waitForTimeout(300);
    out.reviewText = await page.evaluate(() => document.getElementById('reviewSummary').innerText.replace(/\n+/g, ' | '));

    const respPromise = page.waitForResponse(r => r.url().includes('/api/listings') && r.request().method() === 'POST', { timeout: 30000 });
    await page.click('#submitBtn');
    const resp = await respPromise;
    out.submitStatus = resp.status();
    const body = await resp.json().catch(() => ({}));
    out.uuid = body.uuid || null;
    if (out.uuid) {
      const r = await db.query(
        'SELECT original_price, listed_price, price_per_head, platform_fee, commission_value, commission_type FROM listings WHERE uuid=$1',
        [out.uuid]
      );
      out.dbRow = r.rows[0] || null;
    }
  } finally {
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
  return out;
}
