// QA: photo reordering on POST-AD must SHIFT (remove & insert), not swap.
// [1,2,3,4,5] drag 1 onto 3 -> [2,3,1,4,5]; then drag 5 onto 1 -> [2,3,5,1,4]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const db = require('./src/utils/db.js');

const stamp = Date.now();
const email = 'shf_' + stamp + '@example.com';
const password = 'TestPass123';

export default async function run(page) {
  const out = {};
  const hash = await bcrypt.hash(password, 10);
  const o = await db.query(
    'INSERT INTO users (name, email, phone, password_hash, role, is_verified, account_group) ' +
    "VALUES ('Shift Owner',$1,$2,$3,'owner',TRUE,$4) RETURNING id",
    [email, '077' + String(stamp).slice(-7), hash, v4()]
  );
  const ownerId = o.rows[0].id;

  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await page.fill('#loginIdentifier', email);
    await page.fill('#loginPassword', password);
    await page.click('#loginSubmitBtn');
    await page.waitForFunction(() => location.pathname.startsWith('/home-agent'), null, { timeout: 15000 });
    await page.goto('http://localhost:3000/post-ad', { waitUntil: 'load' });
    await page.waitForTimeout(500);

    // Generate 5 distinct solid-colour PNGs in the page itself.
    const dataUrls = await page.evaluate(() => ['#e11', '#1b1', '#11b', '#eb2', '#c1b'].map(c => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 40;
      const ctx = cv.getContext('2d'); ctx.fillStyle = c; ctx.fillRect(0, 0, 40, 40);
      return cv.toDataURL('image/png');
    }));

    await page.setInputFiles('#coverInput', {
      name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(dataUrls[0].split(',')[1], 'base64')
    });
    await page.waitForTimeout(300);
    const files = dataUrls.map((d, i) => ({
      name: 'p' + i + '.png', mimeType: 'image/png', buffer: Buffer.from(d.split(',')[1], 'base64')
    }));
    await page.setInputFiles('#fileInput', files);
    await page.waitForTimeout(500);

    // Read each tile's colour (identifies photos across re-renders)
    const readColors = () => page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#photoPreview [data-index]').forEach(t => {
        const img = t.querySelector('img');
        const c = document.createElement('canvas'); c.width = c.height = 1;
        c.getContext('2d').drawImage(img, 0, 0, 1, 1);
        const [r, g, b] = c.getContext('2d').getImageData(0, 0, 1, 1).data;
        out.push(r > 180 && g < 90 && b < 90 ? 'red' : g > 150 && r < 90 ? 'green'
          : b > 150 && r < 90 ? 'blue' : r > 180 && g > 150 && b < 90 ? 'yellow'
            : r > 150 && b > 150 && g < 90 ? 'magenta' : `${r},${g},${b}`);
      });
      return out;
    });

    out.before = await readColors(); // expect [red,green,blue,yellow,magenta]

    // Count real DOM drag events so we know the drop actually fired
    await page.evaluate(() => {
      window._ev = { dragstart: 0, drop: 0 };
      document.getElementById('photoPreview').addEventListener('dragstart', () => window._ev.dragstart++);
      document.getElementById('photoPreview').addEventListener('drop', () => window._ev.drop++);
    });
    out.evInit = await page.evaluate(() => window._ev);

    const realDrag = async (fromIdx, toIdx) => {
      const a = await page.$(`#photoPreview [data-index="${fromIdx}"]`);
      const b = await page.$(`#photoPreview [data-index="${toIdx}"]`);
      const ba = await a.boundingBox(), bb = await b.boundingBox();
      await page.mouse.move(ba.x + ba.width / 2, ba.y + ba.height / 2);
      await page.mouse.down();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    };

    // Drag photo 1 (index 0, green) onto photo 3 (index 2, yellow)
    await realDrag(0, 2);
    out.afterDrag1Onto3 = await readColors();
    out.evAfterDrag1 = await page.evaluate(() => window._ev);
    // A drag must NOT leak into the tap path: no selection, no toast, no move.
    out.tapState = await page.evaluate(() => ({
      selected: document.querySelector('#photoPreview .tap-selected') ? 'LEAKED' : 'clean',
      toast: !!document.querySelector('.toast'),
    }));
    // And a genuine tap right after the drag must still select.
    const g0 = await page.$('#photoPreview [data-index="0"]');
    const gb = await g0.boundingBox();
    await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await page.waitForTimeout(300);
    out.tapAfterDrag = await page.evaluate(() => ({
      selected: document.querySelector('#photoPreview .tap-selected') ? 'selected' : 'not-selected',
      toast: !!document.querySelector('.toast'),
    }));

    // Drag photo 5 (index 4) onto photo 1 (index 0)
    await page.dragAndDrop('#photoPreview [data-index="4"]', '#photoPreview [data-index="0"]');
    await page.waitForTimeout(300);
    out.afterDrag5Onto1 = await readColors();
    out.evAfterDrag2 = await page.evaluate(() => window._ev);

    return out;
  } finally {
    await db.query('DELETE FROM users WHERE id=$1', [ownerId]).catch(() => { });
  }
}
