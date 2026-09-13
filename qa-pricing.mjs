// QA: post-ad pricing tab — Agent vs Owner, commission (percent/amount), fee math.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'pp_' + stamp + '@example.com';
const password = 'TestPass123';

// Helper: fill the wizard up to step 3 (pricing) and return the pricing model.
export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const o = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Price Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '089' + String(stamp).slice(-7), hash, v4()]
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

    // Step 1: two photos
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 40;
      const x = c.getContext('2d'); x.fillStyle = '#345'; x.fillRect(0, 0, 40, 40);
      return c.toDataURL('image/png');
    });
    const buf = Buffer.from(png.split(',')[1], 'base64');
    await page.setInputFiles('#coverInput', { name: 'cover.png', mimeType: 'image/png', buffer: buf });
    await page.setInputFiles('#fileInput', [{ name: 'p1.png', mimeType: 'image/png', buffer: buf }]);
    await page.waitForTimeout(500);
    await page.click('#nextBtn'); // -> step 2

    await page.fill('#adTitle', 'QA Pricing Room');
    await page.fill('#adDescription', 'QA description for the pricing tab check.');
    await page.click('#nextBtn'); // -> step 3 (pricing)

    // Now on step 3. Set occupancy + price.
    await page.selectOption('#adOccupancy', '2'); // 2-in-1
    await page.fill('#adOriginalPrice', '1000');  // room total = 2000
    await page.waitForTimeout(150);

    const readPreview = () => page.evaluate(() => ({
      commissionBlockVisible: document.getElementById('commissionBlock').style.display !== 'none',
      perHead: document.getElementById('prevPerHead').textContent,
      roomTotal: document.getElementById('prevRoomTotal').textContent,
      commission: document.getElementById('prevCommission').style.display !== 'none' ? document.getElementById('prevCommission').textContent : null,
      taxable: document.getElementById('prevTaxable').style.display !== 'none' ? document.getElementById('prevTaxable').textContent : null,
      feeLabel: document.getElementById('prevFeeLabel').textContent,
      fee: document.getElementById('prevPlatformFee').textContent,
    }));

    // ── OWNER mode (default): 7% of room total ──
    out.ownerDefault = await readPreview();

    // ── AGENT mode, PERCENT commission (10%) ──
    // The radio itself is visually hidden (styled label), so click the label.
    await page.click('.poster-type-opt:has(input[value="agent"])');
    await page.waitForTimeout(200);
    await page.fill('#adCommission', '10');
    await page.selectOption('#adCommissionType', 'percent');
    await page.waitForTimeout(150);
    out.agentPercent10 = await readPreview();

    // ── AGENT mode, FLAT amount (GHS 500) ──
    await page.selectOption('#adCommissionType', 'amount');
    await page.fill('#adCommission', '500');
    await page.waitForTimeout(150);
    out.agentAmount500 = await readPreview();

    // Keep agent mode active with a 10% commission, then complete the rest and
    // SUBMIT so we can verify what the server actually persisted.
    await page.selectOption('#adCommissionType', 'percent');
    await page.fill('#adCommission', '10');
    await page.waitForTimeout(120);

    await page.click('#nextBtn'); // -> step 4 amenities (defaults)
    await page.click('#nextBtn'); // -> step 5 location
    await page.waitForTimeout(400);
    // Set the map pin + area + landmark (step 5 requires all three).
    await page.evaluate(() => {
      document.getElementById('adLat').value = '7.3400';
      document.getElementById('adLng').value = '-2.3300';
    });
    await page.fill('#adLocationArea', 'QA Area, Sunyani');
    await page.fill('#adLandmark', 'QA Landmark');
    await page.waitForTimeout(200);
    await page.click('#nextBtn'); // -> review
    await page.waitForTimeout(400);
    out.reviewText = await page.evaluate(() => {
      const el = document.getElementById('reviewSummary');
      return el ? el.innerText.replace(/\n+/g, ' | ') : null;
    });

    // Submit and wait for the API call.
    const respPromise = page.waitForResponse(r => r.url().includes('/api/listings') && r.request().method() === 'POST', { timeout: 30000 });
    await page.click('#submitBtn');
    const resp = await respPromise;
    out.submitStatus = resp.status();
    const body = await resp.json().catch(() => ({}));
    out.submittedUuid = body.uuid || null;

    // Read the stored row.
    if (out.submittedUuid) {
      const row = await db.query(
        'SELECT poster_type, commission_type, commission_value, platform_fee_rate, platform_fee, original_price, price_per_head FROM listings WHERE uuid=$1',
        [out.submittedUuid]
      );
      out.dbRow = row.rows[0] || null;
    }
  } finally {
    // Remove the test listing + its owner (listing cascades with the owner).
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
  return out;
}
