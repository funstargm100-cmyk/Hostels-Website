import mod from './qa-map-like.mjs';
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
try {
  console.log(JSON.stringify(await mod(p), null, 2));
} catch (e) {
  console.error('QA ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
