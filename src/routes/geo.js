const router = require('express').Router();

// Small in-memory cache so repeat searches don't hammer Nominatim
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Curated popular places (Ghana) shown as quick-pick chips.
// Each entry is searched via Nominatim on demand — we only keep labels here.
const POPULAR_PLACES = [
  { label: 'KNUST', emoji: '🎓', query: 'KNUST' },
  { label: 'University of Ghana, Legon', emoji: '🎓', query: 'University of Ghana, Legon, Accra' },
  { label: 'UENR Sunyani', emoji: '🎓', query: 'UENR Sunyani' },
  { label: 'UCC Cape Coast', emoji: '🎓', query: 'University of Cape Coast' },
  { label: 'Ho Technical University', emoji: '🎓', query: 'Ho Technical University, Ho' },
  { label: 'Takoradi Technical University', emoji: '🎓', query: 'Takoradi Technical University' },
  { label: 'University for Development Studies', emoji: '🎓', query: 'University for Development Studies, Tamale' },
  { label: 'GIMPA', emoji: '🎓', query: 'Ghana Institute of Management and Public Administration, Accra' },
  { label: 'Accra Mall', emoji: '🛍️', query: 'Accra Mall' },
  { label: 'Kumasi City Mall', emoji: '🛍️', query: 'Kumasi City Mall' },
  { label: 'Kotoka Int. Airport', emoji: '✈️', query: 'Kotoka International Airport, Accra' },
  { label: 'Makola Market', emoji: '🧺', query: 'Makola Market, Accra' }
];

// GET /api/geo/popular — the quick-pick chips
router.get('/popular', (req, res) => {
  res.json({ places: POPULAR_PLACES });
});

// GET /api/geo/search?q=... — proxy to Nominatim (schools, banks, restaurants, anything)
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ results: [] });

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return res.json({ results: hit.results });

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '6');
    // Bias to Ghana, but don't hard-restrict (someone may study near a border town)
    url.searchParams.set('countrycodes', 'gh');
    url.searchParams.set('accept-language', 'en');

    const r = await fetch(url, {
      headers: { 'User-Agent': 'Roomy/1.0 (student housing marketplace)' }
    });
    if (!r.ok) throw new Error('Upstream error ' + r.status);
    const data = await r.json();

    const results = data.map(d => {
      const addr = d.address || {};
      const primary = addr.amenity || addr.tourism || addr.building || addr.office || addr.shop ||
        addr.university || addr.school || addr.college || addr.hospital || addr.suburb ||
        addr.neighbourhood || addr.village || addr.town || addr.city || '';
      const region = addr.state || addr.county || '';
      const name = d.name || primary || d.display_name.split(',')[0];
      return {
        name,
        detail: [primary && primary !== name ? primary : null, addr.city || addr.town, region]
          .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i && v !== name).slice(0, 2).join(', '),
        display: d.display_name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        type: d.type || d.class || ''
      };
    });

    cache.set(key, { t: Date.now(), results });
    res.json({ results });
  } catch (err) {
    console.error('GEO SEARCH ERROR:', err.message);
    res.status(502).json({ error: 'Location search unavailable right now' });
  }
});

// GET /api/geo/route?from_lat=..&from_lng=..&to_lat=..&to_lng=..
// Proxy to OSRM (OpenStreetMap's public routing engine) so the map can draw a
// path that follows actual roads instead of a straight line. Cached like the
// search endpoint — the demo OSRM server is rate-limited and its answers for a
// given coordinate pair never change, so caching is both polite and cheap.
const routeCache = new Map();
const ROUTE_TTL = 1000 * 60 * 30; // 30 minutes

router.get('/route', async (req, res) => {
  const fromLat = parseFloat(req.query.from_lat);
  const fromLng = parseFloat(req.query.from_lng);
  const toLat = parseFloat(req.query.to_lat);
  const toLng = parseFloat(req.query.to_lng);
  const nums = [fromLat, fromLng, toLat, toLng];
  if (!nums.every(Number.isFinite)) {
    return res.status(400).json({ error: 'Valid from/to coordinates are required' });
  }

  // ~4dp is about 11 m of precision — plenty for a road trace, and it keeps the
  // cache key stable across tiny float jitter between requests.
  const key = nums.map(n => n.toFixed(4)).join(',');
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.t < ROUTE_TTL) return res.json({ route: hit.route });

  try {
    // OSRM wants {lng},{lat} pairs, in that order — a classic mix-up.
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}`;
    const params = new URLSearchParams({ overview: 'full', geometries: 'geojson' });
    const r = await fetch(`${url}?${params}`, {
      headers: { 'User-Agent': 'Roomy/1.0 (student housing marketplace)' }
    });
    if (!r.ok) throw new Error('Upstream error ' + r.status);
    const data = await r.json();
    const route = data.routes && data.routes[0];
    if (!route || !route.geometry || !route.geometry.coordinates) {
      return res.status(404).json({ error: 'No route found between those points' });
    }

    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng]. Flip on the way out so
    // the client never has to think about the ordering.
    const latlngs = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const payload = {
      coords: latlngs,
      distance_m: route.distance,
      duration_s: route.duration
    };
    routeCache.set(key, { t: Date.now(), route: payload });
    res.json({ route: payload });
  } catch (err) {
    console.error('GEO ROUTE ERROR:', err.message);
    res.status(502).json({ error: 'Routing unavailable right now' });
  }
});

module.exports = router;
