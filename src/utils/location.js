// Adds ±150–300m random offset to coordinates for privacy
function applyLocationJitter(lat, lng) {
  const metersToDegreesLat = 1 / 111320;
  const metersToDegreesLng = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const offsetMeters = 150 + Math.random() * 150; // 150–300m
  const angle = Math.random() * 2 * Math.PI;
  let jLat = lat + offsetMeters * Math.cos(angle) * metersToDegreesLat;
  let jLng = lng + offsetMeters * Math.sin(angle) * metersToDegreesLng;
  // Defensive clamp: never let a bad input (NaN/undefined) or numeric
  // overflow produce a marker that lands far from the real room.
  if (!Number.isFinite(jLat) || Math.abs(jLat - lat) > 0.01) jLat = lat;   // ~1.1 km cap
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
