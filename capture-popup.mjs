import mod from './qa-map-verify.mjs';
import { chromium } from 'playwright';

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
p_run: {
  const r = await mod(page);
  console.log(JSON.stringify(r, null, 2));
  const popupEl = await page.$('.leaflet-popup');
  if (popupEl) await popupEl.screenshot({ path: 'popup-element.png' });
  await page.screenshot({ path: 'popup-current.png' });
}
await b.close();
