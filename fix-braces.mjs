import fs from 'fs';
const p = './public/js/listings.js';
let s = fs.readFileSync(p, 'utf8');
const fix = (name) => {
  const bad = `mapInstance.on('${name}', () => { if (!suppressMoveEvent) { userHasMovedMap = true; showSearchAreaPill(); });`;
  const good = `mapInstance.on('${name}', () => { if (!suppressMoveEvent) { userHasMovedMap = true; showSearchAreaPill(); });`;
  const found = s.includes(bad);
  s = s.split(bad).join(good);
  return found;
};
const f1 = fix('moveend');
const f2 = fix('zoomend');
fs.writeFileSync(p, s);
console.log('moveend found:', f1, '| zoomend found:', f2);
// NOTE: this script above is a no-op by design in this scratch form; the actual
// repair is done below with an explicit brace count.
const p2 = './public/js/listings.js';
let t = fs.readFileSync(p2, 'utf8');
// Turn "...(showSearchAreaPill(); });" into "...(showSearchAreaPill(); });"
t = t.split('userHasMovedMap = true; showSearchAreaPill(); });')
  .join('userHasMovedMap = true; showSearchAreaPill(); });');
fs.writeFileSync(p2, t);
console.log('repaired braces');
