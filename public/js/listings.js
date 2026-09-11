let currentPage = 1;
let currentView = 'grid';
let nearMeLat = null;
let nearMeLng = null;
// Radius (km) for the proximity filter. "Near Me" leaves it null (backend default
// 5km); "Search this area" sets it to the radius covering the current viewport.
let nearMeKm = null;
// Set when the current fetch was triggered by "Search this area", so the map
// renders the new pins WITHOUT reframing the camera the user just positioned.
let pendingMapAreaSearch = false;

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
    // "Near Me" uses a fixed 5km radius; "Search this area" sets nearMeKm to the
    // radius that covers the current viewport.
    f.near_km = nearMeKm || 5;
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
    // "Search this area" keeps the user's chosen viewport; every other fetch
    // (fresh search, filter, pagination) frames the camera on the results.
    if (currentView === 'map') {
      renderMapListings(!pendingMapAreaSearch);
      pendingMapAreaSearch = false;
    }
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
  nearMeLat = null; nearMeLng = null; nearMeKm = null;
  const btn = document.getElementById('nearMeBtn');
  if (btn) { btn.classList.remove('btn-primary'); btn.classList.add('btn-ghost'); btn.innerHTML = '<i data-lucide="navigation"></i> Near Me'; if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] }); }
  applyFilters();
}

function filterNearMe() {
  const btn = document.getElementById('nearMeBtn');
  if (nearMeLat && nearMeLng) {
    // Toggle off
    nearMeLat = null; nearMeLng = null; nearMeKm = null;
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
// True while WE move the camera (fitBounds/flyTo), so the moveend/zoomend
// handlers can tell our programmatic moves apart from a genuine user pan/zoom.
let suppressMoveEvent = false;
// True between movestart/zoomstart and their end events — a marker click during
// that window is deferred rather than lost.
let mapBusy = false;
function setSuppress(v) { suppressMoveEvent = v; }
// Debounce so a continuous drag only reveals the pill once the user settles.
let searchAreaPillTimer = null;

function ensureMap() {
  const el = document.getElementById('mapSearch');
  if (!el) return null;
  if (!mapInstance) {
    // Modelled on Google Maps' map search:
    //   • Panning is ALLOWED — it is the primary gesture. Instead of fighting it,
    //     we make it safe: moving the map never silently drops results, it just
    //     reveals a "Search this area" pill the user clicks to re-query, exactly
    //     like Google Maps (and the "Map Search by Area" pattern in enterprise
    //     GIS UIs).
    //   • Zoom     — scroll wheel + pinch + the +/- control.
    //   • Rotation — the leaflet-rotate plugin's compass, plus ← / → keys. We
    //     keep `touchRotate`/`shiftKeyRotate` OFF so a rotation can never be
    //     mistaken for a pan.
    mapInstance = L.map(el, {
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: true,
      // The zoom control is placed top-right, the same corner Google Maps uses
      // for its secondary map controls (recenter sits bottom-right via CSS).
      zoomControl: false,
      rotate: true,
      bearing: 0,
      touchRotate: false,
      shiftKeyRotate: false,
      rotateControl: { closeOnZeroBearing: false }
    }).setView([5.6037, -0.1870], 12); // Accra default
    L.control.zoom({ position: 'topright' }).addTo(mapInstance);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance);
    mapMarkersLayer = L.layerGroup().addTo(mapInstance);
    // A single reusable layer for the base↔room trace line, drawn on popup open.
    mapTraceLayer = L.layerGroup().addTo(mapInstance);
    // Rotate with the ← / → keys once the map has focus. This is an explicit
    // gesture that can never be mistaken for a pan, unlike Shift+drag or a
    // two-finger twist, which is why those two are disabled above.
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
    // Google-style "Search this area": whenever the USER moves the map (pan or
    // zoom), reveal the pill. Programmatic moves (fitBounds/flyTo) must NOT
    // trigger it, or it would flash on every render — hence the `suppressMoveEvent`
    // guard that every camera helper we call sets for the duration of its move.
    mapInstance.on('moveend', () => { if (!suppressMoveEvent) showSearchAreaPill(); });
    mapInstance.on('zoomend', () => { if (!suppressMoveEvent) showSearchAreaPill(); });
    // Keep an OPEN popup glued to its marker when the map is rotated or panned.
    // The rotate plugin only repositions popups during zoom-animated moves, so
    // without this the bubble drifts away from its pin (and can end up
    // off-screen) after a rotate or a drag. Calling update() re-runs Leaflet's
    // own anchor maths, which the plugin has already corrected for bearing.
    mapInstance.on('rotate', deferPopupUpdate);
    mapInstance.on('moveend zoomend', deferPopupUpdate);
    // Track whether a move is in flight, so a marker click that lands mid-gesture
    // can be deferred instead of silently swallowed (the "click does nothing"
    // symptom on a rotating/animating map).
    mapInstance.on('movestart zoomstart', () => { mapBusy = true; window.__mapBusy = true; });
    mapInstance.on('moveend zoomend', () => { mapBusy = false; window.__mapBusy = false; });
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

// fitToResults:
//   true  — a fresh search / first map open: frame the camera on the results and
//           remember that area as "the searched area".
//   false — the user already framed an area (e.g. clicked "Search this area"):
//           plot the new pins but leave the camera where they put it, exactly
//           like Google Maps which never yanks the view back on you.
function renderMapListings(fitToResults = true) {
  const map = ensureMap();
  if (!map) return;
  mapMarkersLayer.clearLayers();
  if (!lastFetchedListings.length) {
    if (fitToResults) {
      setMapViewGuarded([5.6037, -0.1870], 12);
    }
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
    // autoPan is OFF on purpose. On a map that can be rotated, Leaflet's autoPan
    // computes padding in UNROTATED pixel space and pans the map to compensate,
    // which fights the rotate plugin on every frame: that is the source of the
    // jitter/lag and of popups landing off-screen. We bring the pin into view
    // ourselves (see openPopupSafely) using bounds that account for rotation.
    marker.bindPopup(() => renderListingCard(l, { isPopup: true }), {
      maxWidth: 280, minWidth: 240, autoPan: false, keepInView: false
    });
    // Replace Leaflet's default open-on-click with our rotation-aware, toggle-safe
    // version. bindPopup() wires `click -> _openPopup`; unbind that one handler
    // (keeping the popup itself bound) and drive the open ourselves so a click
    // that lands mid-rotate/mid-pan is deferred instead of being lost.
    if (marker._openPopup) marker.off('click', marker._openPopup, marker);
    marker.on('click', () => {
      if (marker.isPopupOpen()) { marker.closePopup(); return; }
      if (mapBusy) {
        // A gesture is still in flight; wait for it to settle so the popup is
        // anchored against the FINAL view rather than a moving target.
        mapInstance.once('moveend zoomend', () => openPopupSafely(marker));
      } else {
        openPopupSafely(marker);
      }
    });
    // Bind the trace to the MARKER itself rather than reading popup._source from
    // a map-level event: that property is not reliably the marker across Leaflet
    // versions, and a wrong source silently traces the wrong room. Here the
    // closure guarantees we always trace the pin that was actually clicked.
    marker.on('popupopen', (e) => {
      const el = e.popup.getElement();
      if (el && typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
      // The plugin only re-anchors popups during zoom-animated moves; nudge once
      // now so the very first frame is already in the right place.
      requestAnimationFrame(() => { if (marker.isPopupOpen()) marker.getPopup().update(); });
      // The photo inside the card grows once it loads, which can push a popup
      // near an edge out of view. Re-fit whenever that happens.
      const img = el && el.querySelector('img');
      if (img) img.addEventListener('load', ensurePopupVisible, { once: true });
      drawTraceToBase(marker);
    });
    marker.on('popupclose', clearTraceLine);
    marker.addTo(mapMarkersLayer);
  });
  if (pts.length && fitToResults) {
    fitBoundsGuarded(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
    // NOTE: the seeker's base is drawn by drawTraceToBase() on popup open, so no
    // standalone base marker is added here. Once the trace is cleared the base
    // disappears with it, which keeps the default map focused on the rooms.
  }
}

// ─── POPUP PLACEMENT ON A ROTATABLE MAP ───────
// A popup's DOM node lives in the non-rotating `norotatePane`, and the rotate
// plugin only re-anchors it during zoom-animated moves. Rotating or panning an
// OPEN popup therefore leaves it stranded, so we explicitly re-run Leaflet's
// anchor maths (update()) once the gesture settles. Coalesced into a rAF so a
// continuous drag stays smooth instead of updating every frame.
let popupUpdateRaf = null;
function deferPopupUpdate() {
  if (popupUpdateRaf !== null) return;
  popupUpdateRaf = requestAnimationFrame(() => {
    popupUpdateRaf = null;
    if (!mapInstance) return;
    const popup = mapInstance._popup;
    if (popup && popup.isOpen()) {
      popup.update();
      // Rotating or panning can swing a tall popup past an edge even though it fit
      // when opened, so re-run the same fit that openPopupSafely uses. Skipped
      // while WE are the ones moving, so our own corrective pan cannot recurse.
      if (!suppressMoveEvent) ensurePopupVisible();
    }
  });
}

// Open a marker's popup and make sure the WHOLE bubble fits in the container.
//
// Leaflet's own autoPan is disabled on these popups because, on a rotated map,
// it computes padding in unrotated pixel space and fights the rotate plugin
// (jitter + popups shoved off-screen). So we do the panning ourselves, in terms
// of the popup's real rendered size:
//   • Open first so the popup can be measured (Leaflet sizes it to its content).
//   • Measure how far it overflows each edge of the map container.
//   • If it overflows, nudge the map by exactly that overflow so the pin ends up
//     with its popup fully on screen.
// Because it pans the MAP (not the popup), it works identically at any bearing
// and the popup stays anchored to its marker.
function openPopupSafely(marker) {
  if (!mapInstance || !marker) return;
  marker.openPopup();
  ensurePopupVisible();
}

// Nudge the map so the currently-open popup sits fully inside the container.
//
// IMPORTANT: measure and pan exactly ONCE, after the popup has settled. An
// earlier version retried on a timer and re-measured mid-animation, so it kept
// re-panning against a stale rect and the map ran away. A single post-open pass
// is both stable and sufficient.
let popupFitTimer = null;
function ensurePopupVisible() {
  clearTimeout(popupFitTimer);
  // Small delay lets Leaflet append + size the popup, and a first image render.
  popupFitTimer = setTimeout(() => {
    if (!mapInstance) return;
    const popup = mapInstance._popup;
    if (!popup || !popup.isOpen()) return;
    const el = popup.getElement();
    if (!el || !el.offsetHeight) return;
    const mr = mapInstance.getContainer().getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    const pad = 12;
    // How far the popup spills past each edge (positive = overflow).
    const overflowTop = mr.top + pad - pr.top;
    const overflowBottom = pr.bottom - (mr.bottom - pad);
    const overflowLeft = mr.left + pad - pr.left;
    const overflowRight = pr.right - (mr.right - pad);
    // We need to move the POPUP by the opposite of each overflow. panBy() moves
    // the map CONTENT in the OPPOSITE sense to its argument (verified: a positive
    // y argument slides content up), so shifting the popup down = negative y.
    //   popup spills above  -> move it down   -> panBy y = -overflowTop
    //   popup spills below  -> move it up     -> panBy y = +overflowBottom
    //   popup spills left   -> move it right  -> panBy x = -overflowLeft
    //   popup spills right  -> move it left   -> panBy x = +overflowRight
    let panX = 0, panY = 0;
    if (overflowLeft > 0) panX = -overflowLeft;
    else if (overflowRight > 0) panX = overflowRight;
    if (overflowTop > 0) panY = -overflowTop;
    else if (overflowBottom > 0) panY = overflowBottom;
    if (!panX && !panY) return; // already fully visible
    // Suppressed so this is not mistaken for a user pan (no "Search this area").
    suppressMoveEvent = true;
    mapInstance.panBy([panX, panY], { animate: true, duration: 0.3 });
    clearSuppressSoon(600);
  }, 120);
}

// ─── GOOGLE-STYLE CAMERA HELPERS ──────────────
// Programmatic camera moves must not be mistaken for a user pan, or the
// "Search this area" pill would flash on every result render. Each helper sets
// `suppressMoveEvent` for the duration of its own move.
// Every programmatic reframe supersedes the user's manual pan, so it also
// withdraws any pending "Search this area" offer before moving the camera.
function setMapViewGuarded(latlng, zoom, opts) {
  if (!mapInstance) return;
  hideSearchAreaPill();
  setSuppress(true);
  mapInstance.setView(latlng, zoom, opts);
  clearSuppressSoon();
}
function fitBoundsGuarded(bounds, opts) {
  if (!mapInstance) return;
  hideSearchAreaPill();
  setSuppress(true);
  mapInstance.fitBounds(bounds, opts);
  clearSuppressSoon();
}
// Eased pan/zoom ("flyTo"), the animation Google Maps uses when it reframes.
function flyToGuarded(latlng, zoom) {
  if (!mapInstance) return;
  hideSearchAreaPill();
  setSuppress(true);
  mapInstance.flyTo(latlng, zoom, { duration: 0.8, easeLinearity: 0.25 });
  clearSuppressSoon(1200);
}
// Moves queue up: hold the suppression a beat past the call so the trailing
// moveend/zoomend from the animation lands inside the window and is ignored.
function clearSuppressSoon(delay = 350) {
  setTimeout(() => setSuppress(false), delay);
}

// ─── "SEARCH THIS AREA" PILL ──────────────────
// The signature Google Maps gesture: after the user moves the map, a pill
// appears inviting them to re-run the search for the new visible area. Results
// are NOT re-fetched until they click it.
function showSearchAreaPill() {
  const pill = document.getElementById('searchAreaPill');
  if (!pill || !mapInstance) return;
  // Match Google Maps: the pill appears after ANY user-driven move of the map,
  // and is hidden only when we re-frame programmatically (a fresh search) or the
  // user acts on it. It does not try to second-guess whether the view still
  // overlaps the last search — that produced false negatives and no pill when it
  // was most useful.
  clearTimeout(searchAreaPillTimer);
  // Debounce: a drag fires moveend repeatedly; only offer the pill after rest.
  searchAreaPillTimer = setTimeout(() => pill.classList.add('show'), 180);
}
function hideSearchAreaPill() {
  const pill = document.getElementById('searchAreaPill');
  if (pill) pill.classList.remove('show');
}

// Turn the current viewport into the same near_lat/near_lng/near_km filter the
// "Near Me" button uses, so the existing backend does the area search with no
// schema change: centre of the view + a radius that covers its corners.
function searchThisArea() {
  if (!mapInstance) return;
  hideSearchAreaPill();
  // Remember that this fetch must NOT reframe the camera (see loadListings).
  pendingMapAreaSearch = true;
  const b = mapInstance.getBounds();
  const center = b.getCenter();
  // Radius = distance to the farthest corner (metres -> km), the smallest circle
  // that still contains the whole visible rectangle.
  const radiusKm = Math.max(0.5, center.distanceTo(b.getNorthEast()) / 1000);
  nearMeLat = center.lat;
  nearMeLng = center.lng;
  nearMeKm = radiusKm;
  applyFilters();
}

// Re-center on the results (or the seeker's base), the crosshair button every
// Google-style map has. Animated, so the camera glides rather than jumps.
function recenterMap() {
  if (!mapInstance) return;
  hideSearchAreaPill();
  const pts = lastFetchedListings
    .map(l => [parseFloat(l.display_lat), parseFloat(l.display_lng)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length) {
    fitBoundsGuarded(L.latLngBounds(pts).pad(0.25), { maxZoom: 15, animate: true });
  } else {
    flyToGuarded([5.6037, -0.1870], 12); // Accra default
  }
}

// Exposed for the inline onclick handlers in listings.html (the file is a classic
// script, so these are already global — made explicit here for clarity/robustness).
window.searchThisArea = searchThisArea;
window.recenterMap = recenterMap;

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
  // NOTE: we deliberately do NOT reframe the map to fit the whole trace any
  // more. The popup is open on a pin the user just chose, and easing the camera
  // away to show the base as well moved that pin (and its popup) under them —
  // the "opens then jumps off-screen" complaint. Like Google Maps, opening a
  // place keeps the camera exactly where it is; the trace simply draws, and the
  // user can hit Re-center if they want the wider view.

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
    // Entering map view always frames the results and clears any stale pill.
    hideSearchAreaPill();
    // If data hasn't arrived yet (user clicked Map immediately), load it —
    // loadListings() renders the map once the rooms come back.
    if (lastFetchedListings.length) renderMapListings(true);
    else loadListings();
  } else {
    // Leaving the map drops any area search so the grid shows the full result
    // set again, the way Google Maps keeps list and map scopes independent.
    if (nearMeKm) { nearMeLat = null; nearMeLng = null; nearMeKm = null; }
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
