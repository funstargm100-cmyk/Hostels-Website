let currentPage = 1;
let currentView = 'grid';
let nearMeLat = null;
let nearMeLng = null;

// ─── OWNER / AGENT VIEW ──────────────────────
// Owners don't browse other people's rooms — /listings becomes their own
// listings manager. We reuse the same page (all the "Browse rooms" nav links
// point here) but swap the content: filters off, their listings in, each with
// View / Edit / Deactivate actions.
const ownerUser = (() => {
  if (!localStorage.getItem('token')) return null;
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
})();
const isOwnerView = ownerUser && ['owner', 'agent', 'admin'].includes(ownerUser.role);

function renderOwnerCard(l) {
  const img = l.primary_image || '/images/placeholder.jpg';
  const statusClass = 'status-' + (l.status || 'pending');
  return `
    <div class="card">
      <div style="position:relative;cursor:pointer" onclick="location.href='/listing?id=${l.uuid}'">
        <img class="card-img" src="${img}" alt="${l.title}" loading="lazy" onerror="this.onerror=null;this.src='/images/placeholder.jpg'" />
        <span class="status-badge ${statusClass}" style="position:absolute;top:.6rem;left:.6rem">${l.status}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${l.title}</div>
        <div class="card-location"><i data-lucide="map-pin"></i> <span>${l.location_area || ''}</span></div>
        <div class="amenity-icons" style="gap:1rem">
          <span class="amenity-icon"><i data-lucide="eye"></i> ${l.views_count || 0} views</span>
          <span class="amenity-icon"><i data-lucide="message-circle"></i> ${l.interest_count || 0} interest</span>
        </div>
      </div>
      <div class="card-footer" style="gap:.5rem;flex-wrap:wrap">
        <div class="card-price">GHS ${Number(l.price_per_head).toLocaleString()}</div>
        <div style="display:flex;gap:.4rem">
          <a href="/edit-listing?id=${l.uuid}" class="btn btn-outline btn-sm"><i data-lucide="pencil"></i> Edit</a>
          ${l.status === 'active'
            ? `<button class="btn btn-ghost btn-sm" onclick="deactivateOwnListing('${l.uuid}')">Deactivate</button>`
            : ''}
        </div>
      </div>
    </div>`;
}

async function loadOwnerListingsView() {
  const grid = document.getElementById('listingsGrid');
  renderSkeletons(grid, 4);
  try {
    const { listings } = await api.get('/api/user/listings');
    const countEl = document.getElementById('resultsCount');
    countEl.textContent = `${listings.length} room${listings.length !== 1 ? 's' : ''}`;

    if (!listings.length) {
      grid.className = 'owner-grid';
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon"><i data-lucide="building-2" style="width:48px;height:48px"></i></div><h3>No rooms yet</h3><p>Post your first room — it's free and takes minutes.</p><a href="/post-ad" class="btn btn-primary btn-sm" style="margin-top:.9rem"><i data-lucide="plus-circle"></i> Post a room</a></div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      document.getElementById('pagination').innerHTML = '';
      return;
    }
    grid.className = 'owner-grid';
    grid.innerHTML = listings.map(renderOwnerCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    document.getElementById('pagination').innerHTML = '';
  } catch (e) {
    grid.innerHTML = `<p class="text-muted">Could not load your rooms: ${e.message}</p>`;
  }
}

async function deactivateOwnListing(uuid) {
  if (!confirm('Deactivate this room?')) return;
  try {
    await api.delete(`/api/listings/${uuid}`);
    showToast('Room deactivated', 'success');
    loadOwnerListingsView();
  } catch (e) { showToast(e.message, 'error'); }
}

// Tailor the page chrome for owners: no browse filters, owner-appropriate copy.
function setUpOwnerView() {
  const title = document.querySelector('.results-toolbar h2');
  if (title) title.textContent = 'My rooms';
  document.title = 'My rooms — Roomy';
  const filters = document.getElementById('filtersPanel');
  if (filters) filters.remove();
  const layout = document.querySelector('.listings-layout');
  if (layout) layout.style.display = 'block';
  // Hide search / sort / near-me / filter controls — they don't apply to own rooms.
  const toolbar = document.querySelector('.results-toolbar > div:last-child');
  if (toolbar) toolbar.innerHTML = `<a href="/post-ad" class="btn btn-primary btn-sm"><i data-lucide="plus-circle"></i> Post a room</a>`;
}

function getFilters() {
  const f = {
    location: document.getElementById('searchLocation').value,
    min_price: document.getElementById('minPrice').value,
    max_price: document.getElementById('maxPrice').value,
    occupancy: document.querySelector('input[name="occupancy"]:checked')?.value || '',
    gender: document.getElementById('genderFilter').value,
    wifi: document.getElementById('filterWifi').checked ? '1' : '',
    parking: document.getElementById('filterParking').checked ? '1' : '',
    water: document.getElementById('waterFilter').value,
    electricity: document.getElementById('electricityFilter').value,
    furnished: document.getElementById('furnishedFilter').value,
    bathroom: document.getElementById('bathroomFilter').value,
    sort: document.getElementById('sortSelect').value,
    page: currentPage,
    limit: 12
  };
  if (nearMeLat && nearMeLng) {
    f.near_lat = nearMeLat;
    f.near_lng = nearMeLng;
    f.near_km = 5; // 5km radius
  }
  return f;
}

async function loadListings() {
  const grid = document.getElementById('listingsGrid');
  renderSkeletons(grid, 6);
  const params = new URLSearchParams();
  const filters = getFilters();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });

  try {
    const data = await api.get('/api/listings?' + params.toString());
    lastFetchedListings = data.listings;
    document.getElementById('resultsCount').textContent = `${data.total} room${data.total !== 1 ? 's' : ''} found`;

    if (!data.listings.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon"><i data-lucide="building-2" style="width:48px;height:48px"></i></div><h3>No rooms found</h3><p>Try adjusting your filters.</p></div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    grid.className = currentView === 'list' ? '' : 'grid-2';
    grid.innerHTML = data.listings.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (currentView === 'map') renderMapListings();
    renderPagination(data.page, data.pages);
  } catch (e) {
    document.getElementById('resultsCount').textContent = 'Could not load rooms';
    grid.innerHTML = `<p class="text-muted">Failed to load rooms: ${e.message}</p>`;
  }
}

function renderPagination(current, total) {
  const el = document.getElementById('pagination');
  if (total <= 1) { el.innerHTML = ''; return; }
  let html = '';
  if (current > 1) html += `<button class="page-btn" onclick="goPage(${current - 1})">←</button>`;
  for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) {
    html += `<button class="page-btn ${i === current ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  }
  if (current < total) html += `<button class="page-btn" onclick="goPage(${current + 1})">→</button>`;
  el.innerHTML = html;
}

function goPage(p) { currentPage = p; loadListings(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function applyFilters() { currentPage = 1; loadListings(); closeFilters(); }
function clearFilters() {
  document.getElementById('searchLocation').value = '';
  const toolbarInput = document.getElementById('toolbarSearch');
  if (toolbarInput) toolbarInput.value = '';
  document.getElementById('minPrice').value = '';
  document.getElementById('maxPrice').value = '';
  document.querySelector('input[name="occupancy"][value=""]').checked = true;
  document.getElementById('genderFilter').value = '';
  document.getElementById('filterWifi').checked = false;
  document.getElementById('filterParking').checked = false;
  document.getElementById('waterFilter').value = '';
  document.getElementById('electricityFilter').value = '';
  document.getElementById('furnishedFilter').value = '';
  document.getElementById('bathroomFilter').value = '';
  document.getElementById('sortSelect').value = '';
  nearMeLat = null; nearMeLng = null;
  const btn = document.getElementById('nearMeBtn');
  if (btn) { btn.classList.remove('btn-primary'); btn.classList.add('btn-ghost'); btn.innerHTML = '<i data-lucide="navigation"></i> Near Me'; if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] }); }
  applyFilters();
}

function filterNearMe() {
  const btn = document.getElementById('nearMeBtn');
  if (nearMeLat && nearMeLng) {
    // Toggle off
    nearMeLat = null; nearMeLng = null;
    if (btn) { btn.classList.remove('btn-primary'); btn.classList.add('btn-ghost'); btn.innerHTML = '<i data-lucide="navigation"></i> Near Me'; if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] }); }
    applyFilters();
    return;
  }
  if (!navigator.geolocation) return showToast('Geolocation not supported', 'error');
  if (btn) { btn.innerHTML = '<i data-lucide="loader"></i> Locating...'; if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] }); }
  navigator.geolocation.getCurrentPosition(pos => {
    nearMeLat = pos.coords.latitude;
    nearMeLng = pos.coords.longitude;
    if (btn) { btn.classList.remove('btn-ghost'); btn.classList.add('btn-primary'); btn.innerHTML = '<i data-lucide="navigation"></i> Near Me ✓'; if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] }); }
    applyFilters();
  }, () => {
    showToast('Could not get your location', 'error');
    if (btn) { btn.innerHTML = '<i data-lucide="navigation"></i> Near Me'; if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] }); }
  });
}
function toggleFilters() { document.getElementById('filtersPanel').classList.toggle('open'); }
function closeFilters() { document.getElementById('filtersPanel').classList.remove('open'); }
// ─── MAP VIEW ────────────────────────────────
// Seekers can switch to a map: listings are plotted with their jittered
// (privacy-safe) coordinates. Distances/times in popups use the REAL
// coordinates against the seeker's daily base location.
let mapInstance = null;
let mapMarkersLayer = null;
let mapTraceLayer = null; // holds the road trace line from a room to the seeker's base
let traceRequestToken = 0; // bumped per trace so a slow route response can't draw stale
let lastFetchedListings = [];

function ensureMap() {
  const el = document.getElementById('mapSearch');
  if (!el) return null;
  if (!mapInstance) {
    // Pan is intentionally EXCLUDED: `dragging: false` (and the touch equivalent
    // below) stops the map surface from being dragged around, so the view stays
    // where the listings are plotted instead of sliding away under a stray swipe.
    // What we DO keep:
    //   • zoom            — scrollWheelZoom + pinch, plus the +/- control
    //   • marker drag     — pins remain draggable (their own `draggable` option,
    //                       unaffected by disabling map panning)
    //   • rotation        — the leaflet-rotate plugin: `rotate` turns it on and
    //                       `rotateControl` renders the compass. We leave
    //                       `touchRotate` (two-finger twist) and `shiftKeyRotate`
    //                       (Shift+drag) OFF so a rotation can never be mistaken
    //                       for a pan. Rotation is available by dragging the
    //                       compass control, or with the ← / → keys on focus.
    mapInstance = L.map(el, {
      scrollWheelZoom: true,
      dragging: false,
      touchZoom: true,
      tap: false,
      rotate: true,
      bearing: 0,
      touchRotate: false,
      shiftKeyRotate: false,
      rotateControl: { closeOnZeroBearing: false }
    }).setView([5.6037, -0.1870], 12); // Accra default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance);
    mapMarkersLayer = L.layerGroup().addTo(mapInstance);
    // A single reusable layer for the base↔room trace line, drawn on popup open.
    mapTraceLayer = L.layerGroup().addTo(mapInstance);
    // Rotate with the ← / → keys once the map has focus. This is an explicit
    // gesture that can never be mistaken for a pan, unlike Shift+drag or a
    // two-finger twist, which is why those two are disabled above. Rotation is
    // independent of panning, so it still works now that `dragging` is off.
    if (typeof mapInstance.setBearing === 'function') {
      mapInstance.getContainer().setAttribute('tabindex', '0');
      mapInstance.getContainer().addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const step = e.key === 'ArrowLeft' ? -15 : 15;
        const next = (((mapInstance.getBearing?.() || 0) + step) % 360 + 360) % 360;
        mapInstance.setBearing(next);
      });
    }
    // Exposed for QA/troubleshooting (theme checks, view assertions, driving the
    // map from tools). Harmless in production and far easier than reverse-
    // engineering internal Leaflet state from the DOM.
    window.__mapInstance = mapInstance;
  }
  // The container may have been hidden (display:none) until now — Leaflet
  // computes bounds against the CURRENT container size, so it MUST be resized
  // and repainted BEFORE markers/fitBounds run, or the view collapses and
  // markers appear missing. Invalidate now and once more after a repaint tick.
  mapInstance.invalidateSize();
  setTimeout(() => mapInstance && mapInstance.invalidateSize(), 80);
  return mapInstance;
}

function renderMapListings() {
  const map = ensureMap();
  if (!map) return;
  mapMarkersLayer.clearLayers();
  if (!lastFetchedListings.length) {
    map.setView([5.6037, -0.1870], 12);
    return;
  }
  const pts = [];
  lastFetchedListings.forEach(l => {
    const lat = parseFloat(l.display_lat), lng = parseFloat(l.display_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    pts.push([lat, lng]);
    // Popups reuse the card renderer but exclude amenities to keep the popup
    // tidy and focused, with details & icons neatly aligned.
    const marker = L.marker([lat, lng]);
    // Remember which listing this pin is for so the trace can be drawn back to
    // the seeker's daily base. Coordinates shown are the jittered ones (already
    // in lat/lng), matching what the marker itself renders.
    marker.__listingLatLng = L.latLng(lat, lng);
    marker.__listingTitle = l.title;
    marker.bindPopup(() => renderListingCard(l, { isPopup: true }), { maxWidth: 280, minWidth: 240, autoPanPadding: [16, 16] });
    // Bind the trace to the MARKER itself rather than reading popup._source from
    // a map-level event: that property is not reliably the marker across Leaflet
    // versions, and a wrong source silently traces the wrong room. Here the
    // closure guarantees we always trace the pin that was actually clicked.
    marker.on('popupopen', (e) => {
      const el = e.popup.getElement();
      if (el && typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
      drawTraceToBase(marker);
    });
    marker.on('popupclose', clearTraceLine);
    marker.addTo(mapMarkersLayer);
  });
  if (pts.length) {
    map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
    // NOTE: the seeker's base is drawn by drawTraceToBase() on popup open, so no
    // standalone base marker is added here. Once the trace is cleared the base
    // disappears with it, which keeps the default map focused on the rooms.
  }
}

// ─── BASE ↔ ROOM TRACE LINE ───────────────────
// When a popup opens, draw a line from the pinned room to the seeker's daily
// base. We ask the server for a road-following route (OSRM) so the trace follows
// streets rather than cutting across buildings; if routing is unavailable we fall
// back to a straight dashed line so the relationship is still visible.
function clearTraceLine() {
  if (mapTraceLayer) mapTraceLayer.clearLayers();
}

// Draw the polylines + end anchors for a given set of [lat,lng] points.
function drawTracePath(points, isRoad) {
  L.polyline(points, {
    color: '#ffffff', weight: isRoad ? 7 : 5, opacity: isRoad ? 0.85 : 0.7, lineCap: 'round'
  }).addTo(mapTraceLayer);
  L.polyline(points, {
    color: '#0e7490', weight: isRoad ? 4 : 2.5, opacity: 1,
    dashArray: isRoad ? null : '8 8', lineCap: 'round'
  }).addTo(mapTraceLayer);
}

async function drawTraceToBase(marker) {
  if (!mapTraceLayer || !marker) return;
  // Leaflet normally hands us the marker in popup._source. Guard against any
  // shape where the coordinate is missing rather than drawing a stray line.
  const room = marker.__listingLatLng;
  if (!room) return;
  clearTraceLine();
  const b = window.__userBaseLoc;
  // No base saved yet (or the base is implausibly far — likely a different
  // region), so there is nothing meaningful to trace.
  if (!b || !b.lat || !b.lng) return;
  const base = L.latLng(b.lat, b.lng);
  if (room.distanceTo(base) > 100000) return; // >100 km: base unrelated to area
  // Ensure both ends of the trace are on screen, otherwise the line runs off
  // the edge and looks like nothing happened. Done BEFORE drawing so geometry
  // is computed against the final view.
  const bounds = L.latLngBounds([base, room]);
  if (!mapInstance.getBounds().contains(bounds)) {
    mapInstance.fitBounds(bounds.pad(0.3), { maxZoom: 15 });
  }

  // Anchor each end so the line reads as a connection between two places.
  L.circleMarker(base, {
    radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1
  }).bindTooltip('Your base location').addTo(mapTraceLayer);
  L.circleMarker(room, {
    radius: 5, color: '#fff', weight: 2, fillColor: '#0e7490', fillOpacity: 1
  }).bindTooltip('Room (approximate)').addTo(mapTraceLayer);

  // Stamp the request so a slow response for a popup the seeker already closed
  // (or replaced) cannot draw a stale route over the current one.
  const token = ++traceRequestToken;
  try {
    const params = new URLSearchParams({
      from_lat: base.lat, from_lng: base.lng,
      to_lat: room.lat, to_lng: room.lng
    });
    const data = await api.get('/api/geo/route?' + params.toString());
    const coords = data?.route?.coords;
    if (token !== traceRequestToken) return; // superseded while we awaited
    if (Array.isArray(coords) && coords.length > 1) {
      drawTracePath(coords, true);
      return;
    }
  } catch { /* fall through to the straight line */ }
  if (token !== traceRequestToken) return;
  drawTracePath([base, room], false);
}

function setView(v) {
  currentView = v;
  const grid = document.getElementById('listingsGrid');
  const mapWrap = document.getElementById('mapWrap');
  if (grid) grid.style.display = v === 'map' ? 'none' : '';
  if (mapWrap) mapWrap.style.display = v === 'map' ? 'block' : 'none';
  if (v === 'map') {
    // If data hasn't arrived yet (user clicked Map immediately), load it —
    // loadListings() renders the map once the rooms come back.
    if (lastFetchedListings.length) renderMapListings();
    else loadListings();
  } else {
    loadListings();
  }
}

// Pre-fill from URL params
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('location')) document.getElementById('searchLocation').value = urlParams.get('location');
if (urlParams.get('max_price')) document.getElementById('maxPrice').value = urlParams.get('max_price');

// Toolbar search box — syncs with the sidebar location filter
(function initToolbarSearch() {
  const toolbarInput = document.getElementById('toolbarSearch');
  const sidebarInput = document.getElementById('searchLocation');
  if (!toolbarInput || !sidebarInput) return;
  toolbarInput.value = sidebarInput.value;
  let debounce;
  toolbarInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      sidebarInput.value = toolbarInput.value;
      applyFilters();
    }, 400);
  });
  // keep toolbar in sync when user edits the sidebar field
  sidebarInput.addEventListener('input', () => { toolbarInput.value = sidebarInput.value; });
})();
if (urlParams.get('occupancy')) {
  const radio = document.querySelector(`input[name="occupancy"][value="${urlParams.get('occupancy')}"]`);
  if (radio) radio.checked = true;
}

// Owners/agents never browse other people's rooms — this page is their own
// listings manager. Decide using the freshly-verified user (not just the cached
// one) so a stale cache can't expose the browse view.
(async function initListingsPage() {
  let role = ownerUser?.role;
  try {
    const verified = await initNavAuth();
    if (verified?.role) role = verified.role;
  } catch { /* fall back to the cached role */ }

  if (['owner', 'agent', 'admin'].includes(role)) {
    setUpOwnerView();
    loadOwnerListingsView();
    if (window.renderFooterNav) window.renderFooterNav();
  } else {
    // Fetch the seeker's daily base location once — used for distance/time lines.
    if (localStorage.getItem('token')) {
      try {
        const me = await api.get('/api/auth/me');
        if (me?.user?.base_lat && me?.user?.base_lng) {
          window.__userBaseLoc = { lat: me.user.base_lat, lng: me.user.base_lng };
        }
      } catch { /* distances just won't show */ }
    }
    loadListings();
  }
})();
