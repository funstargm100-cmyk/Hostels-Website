// Runner for qa-liked-refresh.mjs
import mod from './qa-liked-refresh.mjs';
import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await b.newPage();
try {
  const result = await mod(p);
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error('QA ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
