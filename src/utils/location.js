// Privacy offset applied to a listing's map coordinates.
//
// Requirements it has to satisfy at once:
//   • the pin must NOT sit on the real room (that would defeat privacy), and
//   • it must stay CLOSE to it (a room shown 150–300m away points at the wrong
//     street and looks like a bug), and
//   • it must be STABLE — the same room has to plot in the same place every
//     time, or the marker appears to teleport each time the list reloads or the
//     user pages through results.
//
// The old version failed the last two: it used Math.random() on every call, so
// each request produced a brand-new point, and the offset floor of 150m (up to
// 300m) put pins far from the room. This version derives the offset from a seed
// (the listing's uuid) so it is deterministic, and keeps the distance small.
const MIN_OFFSET_M = 40;   // never sit on the exact spot…
const MAX_OFFSET_M = 110;  // …but never stray further than about a block
// Small deterministic PRNG (mulberry32). Seeded from the uuid, it yields the same
// sequence for the same listing on every server process and every request, with
// no shared state to store.
function seededRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `seed` is the listing's uuid. When it is missing we fall back to a hash of the
// coordinates, which is still stable for that room (unlike Math.random).
function applyLocationJitter(lat, lng, seed) {
  const key = seed ? String(seed) : `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const rand = seededRandom(key);
  const metersToDegreesLat = 1 / 111320;
  const metersToDegreesLng = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  // Distance in [MIN, MAX), direction anywhere on the circle. sqrt() keeps the
  // points evenly spread over the disc rather than clustered near the centre.
  const t = rand();
  const offsetMeters = Math.sqrt(MIN_OFFSET_M * MIN_OFFSET_M +
    t * (MAX_OFFSET_M * MAX_OFFSET_M - MIN_OFFSET_M * MIN_OFFSET_M));
  const angle = rand() * 2 * Math.PI;
  let jLat = lat + offsetMeters * Math.cos(angle) * metersToDegreesLat;
  let jLng = lng + offsetMeters * Math.sin(angle) * metersToDegreesLng;
  // Defensive clamp: never let a bad input (NaN/undefined) or numeric overflow
  // produce a marker that lands far from the real room. 0.01deg is ~1.1km, well
  // above MAX_OFFSET_M, so only genuinely broken values are snapped back.
  if (!Number.isFinite(jLat) || Math.abs(jLat - lat) > 0.01) jLat = lat;
  if (!Number.isFinite(jLng) || Math.abs(jLng - lng) > 0.01) jLng = lng;
  return { lat: jLat, lng: jLng };
}

// Haversine distance in km
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { applyLocationJitter, calculateDistance };
