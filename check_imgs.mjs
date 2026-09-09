export default async function run(page) {
  await page.waitForTimeout(8000);
  const imgs = await page.evaluate(() =>
    [...document.querySelectorAll('#featuredListings img')].map(i => ({
      src: (i.currentSrc || i.src).split('/').pop().slice(0, 40),
      complete: i.complete,
      w: i.naturalWidth,
      loading: i.loading
    }))
  );
  return imgs;
}
