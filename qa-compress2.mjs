// Verify client-side image compression on the REAL post-ad page (after login),
// using a generated 4032x3024 photo. Reports the before/after sizes, which is
// what determines whether FUNCTION_PAYLOAD_TOO_LARGE can still happen.
export default async function run(page) {
  // Log in so /post-ad does not redirect to /login (which lacks app.js).
  await page.goto('http://localhost:3000/login');
  await page.waitForSelector('#loginForm');
  await page.fill('#loginIdentifier', 'test.seeker.su@example.com');
  await page.fill('#loginPassword', 'QaTracePass123!');
  await page.click('#loginSubmitBtn');
  await page.waitForTimeout(4000);

  // Seeker cannot post; log in as an owner/agent instead if one exists, else
  // just verify the helper directly on a page that loads app.js.
  const onPostAd = page.url().includes('post-ad');
  if (!onPostAd) {
    await page.goto('http://localhost:3000/post-ad');
    await page.waitForTimeout(2000);
  }
  const finalUrl = page.url();
  const hasHelper = await page.evaluate(() => typeof compressImage === 'function');
  if (!hasHelper) return { error: 'compressImage not on page', finalUrl };

  return await page.evaluate(async () => {
    const W = 4032, H = 3024;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() * 255) | 0;
      d[i] = n; d[i + 1] = (n * 0.8 + 40) | 0; d[i + 2] = (n * 0.6 + 70) | 0; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const bigBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
    const bigFile = new File([bigBlob], 'big-phone-photo.jpg', { type: 'image/jpeg' });

    const t0 = performance.now();
    const one = await compressImage(bigFile);
    const ms = Math.round(performance.now() - t0);

    // And a 10-photo batch, which is the actual worst case for the payload limit.
    const batch = [];
    for (let i = 0; i < 10; i++) batch.push(new File([bigBlob], `p${i}.jpg`, { type: 'image/jpeg' }));
    const originalTotal = batch.reduce((n, f) => n + f.size, 0);
    const compressedBatch = await compressImages(batch, {}, () => { });
    const compressedTotal = compressedBatch.reduce((n, r) => n + r.size, 0);

    return {
      single: {
        originalHuman: formatBytes(bigFile.size),
        compressedHuman: formatBytes(one.size),
        percentSmaller: Math.round((1 - one.ratio) * 100),
        dimensions: one.width + 'x' + one.height,
        outputType: one.file.type,
        tookMs: ms,
        skipped: one.skipped
      },
      tenPhotoUpload: {
        originalHuman: formatBytes(originalTotal),
        compressedHuman: formatBytes(compressedTotal),
        percentSmaller: Math.round((1 - compressedTotal / originalTotal) * 100),
        underVercelLimit: compressedTotal < 4.5 * 1024 * 1024,
        vercelLimitHuman: '4.5 MB'
      },
      skippedSmallFile: (await compressImage(new File([new Uint8Array(1000)], 'tiny.jpg', { type: 'image/jpeg' }))).skipped,
      skippedGif: (await compressImage(new File([new Uint8Array(500000)], 'a.gif', { type: 'image/gif' }))).skipped,
      skippedText: (await compressImage(new File([new Uint8Array(500000)], 'a.txt', { type: 'text/plain' }))).skipped
    };
  });
}
