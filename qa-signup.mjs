export default async function run(page, ui) {
  const out = {};
  // Step 1 → click seeker card (via DOM, avoids actionability flake)
  await page.evaluate(() => document.querySelector('.su-role-card[data-role="seeker"]').click());
  await page.waitForSelector('#suMap', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1200); // let leaflet tiles settle
  out.mapVisible = await page.locator('#suMap').isVisible();
  out.stepTitle = await page.locator('#suStepTitle').innerText();
  out.geolocateBtn = await page.locator('text=Use my current location').count();

  // simulate dropping a pin (click center of map)
  const box = await page.locator('#suMap').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);
  out.pinStatus = await page.locator('#suPinStatus').innerText();
  out.latSet = await page.locator('#suBaseLat').inputValue();

  await page.screenshot({ path: 'signup-step2-map.png' });

  // Continue → details
  await page.evaluate(() => document.getElementById('suMapNextBtn').click());
  await page.waitForSelector('#seekerDetailsForm', { state: 'visible', timeout: 5000 });
  out.detailsVisible = await page.locator('#seekerDetailsForm').isVisible();
  out.step3Title = await page.locator('#suStepTitle').innerText();
  await page.screenshot({ path: 'signup-step3-details.png' });

  // Fill and submit (expect success + redirect)
  await page.fill('#suSeekerName', 'Test Seeker');
  await page.fill('#suSeekerEmail', 'seeker.' + Date.now() + '@example.com');
  await page.fill('#suSeekerPassword', 'password123');
  await page.evaluate(() => document.getElementById('seekerSubmitBtn').click());
  await page.waitForTimeout(2200);
  out.urlAfter = page.url();
  out.errorShown = await page.evaluate(() => { const el = document.getElementById('signupError'); return el.style.display !== 'none' ? el.textContent : null; });
  return out;
}
