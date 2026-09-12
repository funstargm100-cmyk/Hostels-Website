let currentPage = 1;
let currentView = 'grid';
let nearMeLat = null;
let nearMeLng = null;
// Radius (km) for the proximity filter. "Near Me" leaves it null (backend default
// 5km); "Search this area" sets it to the radius covering the current viewport.
let nearMeKm = null;
// Scope of the last "Search this area" click, kept SEPARATE from nearMe*: it
// used to live in the same variables and silently kept constraining every later
// filter/search to the old viewport — which read as "filters don't work on the
// map". Near Base is a deliberate user filter and survives; the area scope is
// just a consequence of where the user happened to pan, so applyFilters() drops
// it the moment the user applies any explicit filter.
let mapAreaScope = null;
// Set when the current fetch was triggered by "Search this area", so the map
// renders the new pins WITHOUT reframing the camera the user just positioned.
let pendingMapAreaSearch = false;
// True once the user has manually moved the map (pan/zoom/rotate). While set, a
// plain re-render (pagination, a filter tweak) must NOT reframe the camera —
// doing so yanked the view (and every pin with it) back to the fitted bounds,
// which is what made markers look like they "jumped far" from where the user had
// left them. Only an explicit fresh search clears it.
let userHasMovedMap = false;

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
  } else if (mapAreaScope) {
    // Viewport scope from "Search this area". Only active until the user applies
    // an explicit filter — applyFilters() clears it (see below).
    f.near_lat = mapAreaScope.lat;
    f.near_lng = mapAreaScope.lng;
    f.near_km = mapAreaScope.km;
  }
  return f;
}

async function loadListings() {
  const grid = document.getElementById('listingsGrid');
  renderSkeletons(grid, 6);
  // On the map, start the live layer: the scan sweep + spinner chip tell the
  // user the map is fetching rather than frozen on the old pins.
  if (currentView === 'map') mapFxFreshSearch();
  const params = new URLSearchParams();
  const filters = getFilters();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });

  try {
    const data = await api.get('/api/listings?' + params.toString());
    lastFetchedListings = data.listings;
    // The results are in — end the sweep and play the scan for the new pins.
    // "Search this area" gets the tighter radar pulse instead, since the user
    // is already looking at the right patch of map.
    if (currentView === 'map') mapFxResults(pendingMapAreaSearch ? 'area' : 'search');
    document.getElementById('resultsCount').textContent = `${data.total} room${data.total !== 1 ? 's' : ''} found`;

    if (!data.listings.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon"><i data-lucide="building-2" style="width:48px;height:48px"></i></div><h3>No rooms found</h3><p>Try adjusting your filters.</p></div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      document.getElementById('pagination').innerHTML = '';
      // On the map: remove every stale pin so nothing suggests results exist,
      // and tell the user why the map is empty (renderMapListings never runs
      // on this path, so the map must be handled here).
      if (currentView === 'map' && mapInstance) {
        mapMarkersLayer.clearLayers();
        setMapEmptyState(true);
      }
      return;
    }

    grid.className = currentView === 'list' ? '' : 'grid-2';
    grid.innerHTML = data.listings.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    // Frame the camera on the results ONLY when the user has not positioned the
    // map themselves. Once they have panned/rotated/zoomed, a re-render (page 2,
    // a filter tweak) must leave the view exactly where they put it — refitting
    // here is what flung the pins back across the screen and read as "markers
    // moved far from their original location".
    if (currentView === 'map') {
      renderMapListings(!pendingMapAreaSearch && !userHasMovedMap);
      pendingMapAreaSearch = false;
    }
    renderPagination(data.page, data.pages);
  } catch (e) {
    mapFxLoading(false);
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
// A fresh search is the ONE case that should frame the camera on the new results,
// so it clears the "user has positioned the map" latch. Pagination deliberately
// does not call this: paging keeps the view the user chose.
function beginFreshSearch() { userHasMovedMap = false; pendingMapAreaSearch = false; }
function applyFilters(fromAreaSearch = false) {
  // An explicit filter (panel Apply, toolbar search, sort, Near Base) supersedes
  // any "Search this area" viewport scope. Only the pill's own re-fetch keeps it.
  if (!fromAreaSearch) mapAreaScope = null;
  currentPage = 1; beginFreshSearch(); loadListings(); closeFilters();
}
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
  mapAreaScope = null;
  const btn = document.getElementById('nearMeBtn');
  setNearMeBtnState(btn, false);
  applyFilters();
}

function filterNearMe() {
  const btn = document.getElementById('nearMeBtn');
  if (nearMeLat && nearMeLng) {
    // Toggle off
    nearMeLat = null; nearMeLng = null; nearMeKm = null;
    setNearMeBtnState(btn, false);
    applyFilters();
    return;
  }
  // "Near base" searches around the seeker's SAVED daily base location (set at
  // signup on the map) instead of the live GPS position — it's stable, works on
  // desktop without a permission prompt, and matches the base↔room distances
  // already shown on the cards.
  const base = window.__userBaseLoc;
  if (!base || !base.lat || !base.lng) {
    return showToast('No base location saved — set one in your profile first', 'warning');
  }
  nearMeLat = base.lat;
  nearMeLng = base.lng;
  setNearMeBtnState(btn, true);
  applyFilters();
}
// Keep the toolbar button's look in sync with the on/off state (it may be absent
// when triggered from the fullscreen map button).
function setNearMeBtnState(btn, on) {
  if (!btn) return;
  btn.classList.toggle('btn-primary', on);
  btn.classList.toggle('btn-ghost', !on);
  btn.innerHTML = `<i data-lucide="navigation"></i> Near Base${on ? ' ✓' : ''}`;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}
function toggleFilters() { document.getElementById('filtersPanel').classList.toggle('open'); }
function closeFilters() { document.getElementById('filtersPanel').classList.remove('open'); }
// Clicking OUTSIDE the filters panel closes it. Ignores clicks inside the panel
// and on the buttons whose whole job is toggling it (the toolbar Filters button
// and the fullscreen hamburger) so they don't immediately re-open/close it.
document.addEventListener('click', (e) => {
  const panel = document.getElementById('filtersPanel');
  if (!panel || !panel.classList.contains('open')) return;
  if (panel.contains(e.target)) return;
  if (e.target.closest && e.target.closest('#mobileFilterBtn, #mapFsMenuBtn, #closeFiltersBtn')) return;
  closeFilters();
});
// ─── MAP VIEW ────────────────────────────────
// Seekers can switch to a map: listings are plotted with their jittered
// (privacy-safe) coordinates. Distances/times in popups use the REAL
// coordinates against the seeker's daily base location.
let mapInstance = null;
let mapMarkersLayer = null;
let mapTraceLayer = null; // holds the road trace line from a room to the seeker's base
let traceRequestToken = 0; // bumped per trace so a slow route response can't draw stale
// Clears the "pins are dropping in" class on the map container once the last
// staggered pin has landed (see renderMapListings).
let pinEnterTimer = null;
let lastFetchedListings = [];
// True while WE move the camera (fitBounds/flyTo), so the moveend/zoomend
// handlers can tell our programmatic moves apart from a genuine user pan/zoom.
let suppressMoveEvent = false;
// Map rotation lock state for the bottom-left rotation knob. UNLOCKED by default
// on both desktop and mobile; clicking the knob toggles it.
let mapRotationLocked = false;
// Opening cinematic: fly from the zoomed-out country view down to Sunyani when
// the map is first created. `pendingIntroFly` arms it in the L.map init block;
// `introFlyUntil` suppresses result-framing (fitBounds) while it plays.
let pendingIntroFly = false;
let introFlyUntil = 0;
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
    //   • Rotation — the rotation knob at the bottom-left of the map: DRAG it to
    //     spin the map, CLICK it to lock/unlock. (The plugin's built-in compass
    //     control is disabled — rotateControl:false — in favour of the knob.
    //     Rotation is UNLOCKED by default on both desktop and mobile. On touch
    //     devices the knob is hidden and a two-finger twist rotates instead.)
    mapInstance = L.map(el, {
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: true,
      // The zoom control is placed top-right, the same corner Google Maps uses
      // for its secondary map controls (recenter sits bottom-right via CSS).
      zoomControl: false,
      rotate: true,
      bearing: 0,
      // Two-finger twist rotates on phones/tablets, where the knob is hidden.
      // The knob's click-lock applies to the ← / → keys; touch rotation stays
      // available because it is an explicit two-finger gesture, not an accident.
      touchRotate: true,
      shiftKeyRotate: false,
      rotateControl: false
    }).setView([7.3349, -2.3268], 6); // start zoomed-out over Sunyani
    // Smooth opening move: glide from the country-level view down to Sunyani.
    // Deferred to the END of ensureMap (after invalidateSize) — starting it
    // here gets interrupted by the size re-measure below.
    pendingIntroFly = true;
    // Leaflet's map-drag handler listens on the whole container and, with the
    // DEFAULT 3px clickTolerance, treats a few pixels of mouse wobble as a pan.
    // A real mouse click almost always moves 2-4px between press and release, so
    // on this rotatable map a click on a pin was being swallowed as a pan — the
    // map shifted and the popup never opened (touch was fine: it needs a much
    // bigger move to count as a drag). Widen the tolerance so a normal click
    // stays a click. The drag handler creates its Draggable lazily on first use,
    // so enforce it on both an immediate and a deferred pass.
    const widenClickTolerance = () => {
      const d = mapInstance.dragging && mapInstance.dragging._draggable;
      if (d) d.options.clickTolerance = 12;
    };
    widenClickTolerance();
    setTimeout(widenClickTolerance, 0);
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
        if (mapRotationLocked) return; // rotation lock also stops the keys
        e.preventDefault();
        const step = e.key === 'ArrowLeft' ? -15 : 15;
        const next = (((mapInstance.getBearing?.() || 0) + step) % 360 + 360) % 360;
        mapInstance.setBearing(next);
      });
    }
    initRotateKnob();

    // ── Rotation knob (bottom-left of the map) ─────────────────────────────
    // DRAG: the map bearing follows horizontal mouse movement (movementX), not
    // the angle around the knob. While dragging, Pointer Lock hides the cursor
    // and delivers UNBOUNDED movementX — the pointer can never hit the screen
    // edge and stop (or jump) mid-drag, which is what made rotation feel
    // uncontrollable. Vertical movement is ignored (horizontal-axis only).
    // CLICK: a short press with no drag toggles the rotation lock — when locked,
    // dragging the knob (and the ← / → keys) does nothing. Unlocked by default.
    function initRotateKnob() {
      const knob = document.getElementById('mapRotateKnob');
      if (!knob || typeof mapInstance.setBearing !== 'function') return;
      let dragging = false, moved = false, startBearing = 0, bearing = 0;
      // Degrees of map rotation per pixel of horizontal mouse travel. Small on
      // purpose: ~3 full screen-widths of drag for a 360° spin feels steady.
      const DEG_PER_PX = 0.2;
      const setLocked = (locked) => {
        mapRotationLocked = locked;
        knob.dataset.locked = String(locked);
        knob.title = locked ? 'Rotation locked — click to unlock' : 'Drag to rotate — click to lock';
        showToast(locked ? 'Map rotation locked' : 'Map rotation unlocked', 'info', 1600);
      };
      const applyBearing = (deg) => {
        bearing = ((deg % 360) + 360) % 360;
        suppressMoveEvent = true;
        mapInstance.setBearing(bearing);
        suppressMoveEvent = false;
        const icon = knob.querySelector('svg, i');
        if (icon) icon.style.transform = `rotate(${bearing}deg)`;
      };
      knob.addEventListener('pointerdown', (e) => {
        if (mapRotationLocked) { e.preventDefault(); return; }
        dragging = true; moved = false;
        startBearing = mapInstance.getBearing?.() || 0;
        lastClientX = e.clientX;
        // CRITICAL: reset the accumulated travel. It used to carry over from the
        // previous drag, so the FIRST pixel of a new drag applied last drag's
        // whole distance at once — the map spun wildly before it started
        // following the mouse.
        travel = 0;
        knob.setPointerCapture(e.pointerId);
        // Hide the cursor and capture unbounded relative movement for the drag.
        // Must be called from a user-activation event, so pointerdown it is. A
        // quick click releases the lock immediately in endDrag, so the toggle
        // still works normally.
        if (knob.requestPointerLock) {
          try { const p = knob.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* unsupported */ }
        }
        e.preventDefault();
      });
      knob.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        // Ignore ALL movement events until the pointer lock is actually engaged.
        // While the lock is still engaging, browsers emit a large movementX burst
        // even though the mouse hasn't moved — that burst was clamped to ±60px
        // and applied as an instant ~12° spin BEFORE the knob responded to the
        // mouse. Waiting for the real lock (or skipping entirely when pointer
        // lock is unsupported) guarantees the map only turns once genuine mouse
        // movement arrives.
        if (knob.requestPointerLock && !document.pointerLockElement) { lastClientX = e.clientX; return; }
        // movementX is the horizontal delta (always present for mouse events);
        // fall back to clientX differencing if the browser doesn't provide it.
        let dx = (typeof e.movementX === 'number') ? e.movementX : e.clientX - lastClientX;
        lastClientX = e.clientX;
        // Clamp absurd deltas (pointer-lock engagement glitches, alt-tab) so a
        // single event can never fling the map.
        if (dx > 60) dx = 60; else if (dx < -60) dx = -60;
        if (!dx) return;
        moved = moved || Math.abs(dx) > 1;
        // Accumulate the small per-event deltas into total travel, then map
        // travel → bearing at a gentle fixed rate. Horizontal axis ONLY —
        // movementY is deliberately ignored.
        travel += dx;
        applyBearing(startBearing - travel * DEG_PER_PX);
      });
      let lastClientX = null, travel = 0;
      const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        // Release the cursor immediately — a quick click un-locks right away so
        // the lock/unlock toggle still feels instant.
        if (document.pointerLockElement) document.exitPointerLock();
      };
      knob.addEventListener('pointerup', endDrag);
      knob.addEventListener('pointercancel', endDrag);
      knob.addEventListener('click', () => {
        if (moved) { moved = false; return; } // it was a drag, not a click
        setLocked(!mapRotationLocked);
      });
      // Keep the knob glyph pointing north as the map rotates by any means
      // (keys, touch twist, reset view).
      mapInstance.on('rotate', () => {
        const icon = knob.querySelector('svg, i');
        if (icon && !dragging) icon.style.transform = `rotate(${mapInstance.getBearing?.() || 0}deg)`;
      });
    }
    // Google-style "Search this area": whenever the USER moves the map (pan or
    // zoom), reveal the pill. Programmatic moves (fitBounds/flyTo) must NOT
    // trigger it, or it would flash on every render — hence the `suppressMoveEvent`
    // guard that every camera helper we call sets for the duration of its move.
    // The same guard tells a real user move apart from our own reframing, which is
    // what lets later renders leave the camera alone. Each handler wraps in braces
    // so `userHasMovedMap` is set ONLY for genuine user gestures.
    mapInstance.on('moveend', () => { if (!suppressMoveEvent) { userHasMovedMap = true; showSearchAreaPill(); } });
    mapInstance.on('zoomend', () => { if (!suppressMoveEvent) { userHasMovedMap = true; showSearchAreaPill(); } });
    mapInstance.on('rotate', () => { if (!suppressMoveEvent) { userHasMovedMap = true; } });
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
    mapInstance.on('movestart zoomstart', () => { mapBusy = true; });
    mapInstance.on('moveend zoomend', () => { mapBusy = false; });
    // Rotation-correct press handling for marker pins (see the note at
    // toggleMarkerPopup). Delegated on the container so it survives the icon
    // nodes Leaflet recreates on every re-render.
    //
    // Uses POINTER events, which unify mouse, touch and pen behind one code path
    // and — unlike Leaflet's own hit-testing — resolve the target in the CURRENT
    // (rotated) layout. A near-stationary press on a pin opens its popup; a real
    // drag is left alone so panning still works.
    let pinDownX = 0, pinDownY = 0, pinDownAt = 0, pinMoved = false, pinPressActive = false;
    let pressedMarker = null; // the pin under the initial press
    const containerEl = mapInstance.getContainer();
    // Timestamp of the last press the pointer path handled, so the touch path can
    // tell "the mouse already did this" from a genuine tap.
    let lastPointerPinHandledAt = 0;
    const pinFromEvent = (target) => {
      const icon = target && target.closest && target.closest('.leaflet-marker-icon');
      if (!icon) return null;
      // Search the markers LAYER, not the map: markers live in mapMarkersLayer, so
      // map.eachLayer() would never see them and every click would look like a miss.
      let found = null;
      if (mapMarkersLayer) {
        mapMarkersLayer.eachLayer((l) => { if (l.getElement && l.getElement() === icon) found = l; });
      }
      return found;
    };
    const pinPressStart = (target, x, y, stopEvent) => {
      pressedMarker = pinFromEvent(target);
      if (!pressedMarker) return false;
      pinDownX = x; pinDownY = y; pinDownAt = Date.now(); pinMoved = false;
      pinPressActive = true;
      // Capture phase, so this runs BEFORE Leaflet's own handlers on the same
      // element; stopImmediatePropagation (not stopPropagation) is what actually
      // cancels a sibling listener — without it Leaflet's Draggable still starts
      // a pan and the pin slides out from under the pointer.
      if (stopEvent) stopEvent();
      return true;
    };
    const pinPressMove = (x, y, tol) => {
      if (!pinPressActive) return;
      if (Math.abs(x - pinDownX) > tol || Math.abs(y - pinDownY) > tol) pinMoved = true;
    };
    const pinPressEnd = () => {
      if (!pinPressActive) return;
      pinPressActive = false;
      // Use the marker captured at PRESS time, not the release target: a small
      // wobble (or a pan that slipped through) can leave the release over the map
      // pane, and re-resolving from the target then found nothing — the popup
      // silently never opened.
      const marker = pressedMarker;
      pressedMarker = null;
      if (pinMoved || Date.now() - pinDownAt > 700) return; // it was a drag/pan
      lastPointerPinHandledAt = Date.now();
      if (marker && marker.__togglePopup) marker.__togglePopup();
    };

    // Mouse + pen via pointer events.
    containerEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // handled below (Leaflet can block these)
      if (e.button !== 0) return;
      pinPressStart(e.target, e.clientX, e.clientY, () => e.stopImmediatePropagation());
    }, true);
    containerEl.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      pinPressMove(e.clientX, e.clientY, 8);
    }, true);
    containerEl.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0) return;
      if (pinPressActive) e.stopImmediatePropagation();
      pinPressEnd();
    }, true);

    // The TOUCH path. On a phone Leaflet calls stopImmediatePropagation() on
    // touchstart (and on the click that follows) at the document level, because it
    // needs touchstart for pinch-zoom. That blocks every listener registered AFTER
    // Leaflet — including anything we add here — so a tap on a pin never reaches
    // the marker and the popup would not open.
    //
    // The bootstrap script in listings.html is registered BEFORE Leaflet, so it is
    // not suppressed; it hit-tests the tap and dispatches a 'map:pin-tap' custom
    // event when a stationary tap lands on a pin. We subscribe to that and open
    // the popup ourselves. Touch needs this; the mouse path above does not, and
    // the lastPointerPinHandledAt guard keeps a mouse click from double-firing.
    window.addEventListener('map:pin-tap', (e) => {
      if (Date.now() - lastPointerPinHandledAt < 500) return; // mouse already did it
      const marker = pinFromEvent(e.detail && e.detail.icon);
      if (marker && marker.__togglePopup) marker.__togglePopup();
    });

    // Exposed for QA/troubleshooting (theme checks, view assertions, driving the
    // map from tools). Harmless in production and far easier than reverse-
    // engineering internal Leaflet state from the DOM.
    window.__mapInstance = mapInstance;
    // Mirror the live map onto the global Leaflet namespace for tooling/QA. The
    // scripts that drive the map (and any future debugging) reach for `L` off
    // the window, so keep it pointing at the real Leaflet rather than the
    // incidental global the CDN bundle leaves behind.
    window.L = L;
  }
  // The container may have been hidden (display:none) until now — Leaflet
  // computes bounds against the CURRENT container size, so it MUST be resized
  // and repainted BEFORE markers/fitBounds run, or the view collapses and
  // markers appear missing. Invalidate now and once more after a repaint tick.
  mapInstance.invalidateSize();
  setTimeout(() => mapInstance && mapInstance.invalidateSize(), 80);
  // Play the opening cinematic here, once the container has a real size — an
  // interrupted/overridden flyTo was why the map never landed on Sunyani. While
  // it plays, renderMapListings() skips its own fitBounds so results can't yank
  // the camera away mid-flight.
  if (pendingIntroFly) {
    pendingIntroFly = false;
    introFlyUntil = Date.now() + 2800;
    flyToGuarded([7.3349, -2.3268], 12, 2.2); // Sunyani
  }
  return mapInstance;
}

// Escape a listing title before it goes into a marker's HTML label. Titles are
// user-supplied, so a stray < or & must not become markup.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Show / hide the "No rooms found" notice centred on the map. Appearing /
// disappearing is animated (map-empty-in / map-empty-out in style.css) so the
// notice slides in instead of punching into place.
function setMapEmptyState(on) {
  const el = document.getElementById('mapEmptyState');
  if (!el) return;
  el.style.display = on ? 'block' : 'none';
  el.classList.toggle('map-empty-in', !!on);
  if (on && typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
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
  clearTraceLine();
  setMapEmptyState(false);
  if (!lastFetchedListings.length) {
    // A search/filter with no matches: wipe the stale pins so nothing on the
    // map suggests results exist, and tell the user why the map is empty.
    setMapEmptyState(true);
    if (fitToResults) {
      setMapViewGuarded([5.6037, -0.1870], 12);
    }
    return;
  }
  // Pins are about to be re-plotted, so the whole set drops in again. The class
  // is put on the map container (not each icon) so a single animation-delay per
  // pin — set below — rolls the pins out across the map.
  const mapContainer = mapInstance && mapInstance.getContainer();
  if (mapContainer) mapContainer.classList.add('map-pin-enter');
  clearTimeout(pinEnterTimer);
  pinEnterTimer = setTimeout(() => {
    if (mapContainer) mapContainer.classList.remove('map-pin-enter');
  }, 2000);
  const pts = [];
  // Each pin lands a beat after the one before it, capped so a large result set
  // does not finish animating seconds after the user has started reading.
  let pinIndex = 0;
  lastFetchedListings.forEach(l => {
    const lat = parseFloat(l.display_lat), lng = parseFloat(l.display_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    pts.push([lat, lng]);
    // Each pin carries the room NAME as a label, so the map can be read at a
    // glance instead of having to open every popup to find out which room a pin
    // is. It is a PERMANENT tooltip rather than a custom divIcon on purpose: the
    // default marker keeps Leaflet's exact anchor maths (the teardrop tip on the
    // coordinate, which we have already fought hard to get right on a rotated
    // map), while Leaflet positions the little label box for us.
    const marker = L.marker([lat, lng]);
    const roomName = (l.title && String(l.title).trim()) || 'Room';
    marker.bindTooltip(escapeHtml(roomName), {
      permanent: true,
      direction: 'bottom',
      className: 'map-pin-label',
      // Nudge the label clear of the teardrop so it does not sit on the glyph.
      offset: [0, 6]
    });
    // Popups reuse the card renderer but exclude amenities to keep the popup
    // tidy and focused, with details & icons neatly aligned.
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
    // (keeping the popup itself bound) and drive the open ourselves.
    if (marker._openPopup) marker.off('click', marker._openPopup, marker);
    const toggleMarkerPopup = () => {
      // TRACE-ONLY mode (popups toggled off): a pin click draws/clears the route
      // to the seeker's base without ever opening the room card.
      if (!popupsEnabled) {
        if (tracedMarker === marker) { // same pin again -> clear the trace
          clearTraceLine(); tracedMarker = null;
          return;
        }
        tracedMarker = marker;
        clearTraceLine();
        drawTraceToBase(marker);
        return;
      }
      if (marker.isPopupOpen()) { marker.closePopup(); return; }
      if (mapBusy) {
        // A gesture is still in flight; wait for it to settle so the popup is
        // anchored against the FINAL view rather than a moving target.
        mapInstance.once('moveend zoomend', () => openPopupSafely(marker));
      } else {
        openPopupSafely(marker);
      }
    };
    // Leaflet's own click handler is RESTORED as the touch path. On a phone,
    // Leaflet calls stopImmediatePropagation on touchstart at the document level
    // (it needs touchstart for pinch-zoom), so a DOM-level touch listener of ours
    // never sees the tap — but Leaflet's own marker "click" still fires for touch.
    //
    // The delegated pointer handler in ensureMap covers the MOUSE case, which is
    // the one Leaflet gets wrong on a rotated map. To stop a mouse click firing
    // both paths (a double toggle that opened then instantly closed the popup),
    // the pointer handler stamps the time it handled a press and this one skips
    // anything inside that window.
    marker.__togglePopup = toggleMarkerPopup;
    // Bind the trace to the MARKER itself rather than reading popup._source from
    // a map-level event: that property is not reliably the marker across Leaflet
    // versions, and a wrong source silently traces the wrong room. Here the
    // closure guarantees we always trace the pin that was actually clicked.
    marker.on('popupopen', (e) => {
      const el = e.popup.getElement();
      if (el && typeof lucide !== 'undefined') lucide.createIcons();
      // Mark the acting pin: a slow breathing halo + a lifted glyph, so the room
      // the user is reading stays findable while the card is open.
      markActivePin(marker);
      // The plugin only re-anchors popups during zoom-animated moves; nudge once
      // now so the very first frame is already in the right place.
      requestAnimationFrame(() => {
        if (marker.isPopupOpen()) {
          marker.getPopup().update();
          // update() rebuilds the popup DOM (see renderPopupIcons above) — re-render
          // the icons it just wiped, or the card opens with dead <i> placeholders.
          renderPopupIcons();
        }
      });
      // The photo inside the card grows once it loads, which can push a popup
      // near an edge out of view. Re-fit whenever that happens.
      const img = el && el.querySelector('img');
      if (img) img.addEventListener('load', ensurePopupVisible, { once: true });
      drawTraceToBase(marker);
      openPopupMarker = marker;
    });
    marker.on('popupclose', () => {
      clearTraceLine(); tracedMarker = null; openPopupMarker = null;
      markActivePin(null);
    });
    marker.addTo(mapMarkersLayer);
    // Stagger this pin's drop-in, then (once it exists in the DOM) give the
    // user the little halo that marks it as freshly placed.
    const delay = Math.min(pinIndex++ * 45, 900);
    const icon = marker.getElement && marker.getElement();
    if (icon) {
      icon.style.setProperty('--pin-delay', delay + 'ms');
      icon.classList.add('map-pin-halo');
      setTimeout(() => icon.classList.remove('map-pin-halo'), delay + 900);
    }
  });
  if (pts.length && fitToResults && Date.now() >= introFlyUntil) {
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
// Leaflet's popup.update() re-runs the bound content FUNCTION and REPLACES the
// popup DOM. Any lucide icons that had been rendered are destroyed and come back
// as raw <i data-lucide> tags — which looked like "icons missing until you toggle
// the theme" (the toggle just re-runs createIcons over the whole document).
// Every update() call must therefore be followed by a re-render.
function renderPopupIcons() {
  const popup = mapInstance && mapInstance._popup;
  const el = popup && popup.getElement();
  if (el && typeof lucide !== 'undefined') lucide.createIcons();
}
function deferPopupUpdate() {
  if (popupUpdateRaf !== null) return;
  popupUpdateRaf = requestAnimationFrame(() => {
    popupUpdateRaf = null;
    if (!mapInstance) return;
    const popup = mapInstance._popup;
    if (popup && popup.isOpen()) {
      popup.update();
      renderPopupIcons();
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
function fitBoundsGuarded(bounds, opts = {}) {
  if (!mapInstance) return;
  hideSearchAreaPill();
  setSuppress(true);
  // flyToBounds instead of fitBounds: an EASED pan+zoom glide (Google-Maps
  // style camera move) rather than an instant snap to the new frame.
  mapInstance.flyToBounds(bounds, { duration: 0.8, easeLinearity: 0.25, ...opts });
  clearSuppressSoon(Math.max(1200, (opts.duration || 0.8) * 1000 + 400));
}
// Eased pan/zoom ("flyTo"), the animation Google Maps uses when it reframes.
// `duration` in seconds — the opening fly-in uses a longer, more cinematic one.
function flyToGuarded(latlng, zoom, duration = 0.8) {
  if (!mapInstance) return;
  hideSearchAreaPill();
  setSuppress(true);
  mapInstance.flyTo(latlng, zoom, { duration, easeLinearity: 0.25 });
  clearSuppressSoon(Math.max(1200, duration * 1000 + 400));
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
  mapAreaScope = { lat: center.lat, lng: center.lng, km: radiusKm };
  // Pass true so this pill-driven re-fetch keeps its own area scope (applyFilters
  // clears it for any user-initiated filter).
  applyFilters(true);
}

// Re-center on the results (or the seeker's base), the crosshair button every
// Google-style map has. Animated, so the camera glides rather than jumps.
function recenterMap() {
  if (!mapInstance) return;
  hideSearchAreaPill();
  // The user explicitly asked to re-frame on the results, so this is now "our"
  // camera position, not theirs — a later re-render may re-fit again.
  userHasMovedMap = false;
  const pts = lastFetchedListings
    .map(l => [parseFloat(l.display_lat), parseFloat(l.display_lng)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length) {
    fitBoundsGuarded(L.latLngBounds(pts).pad(0.25), { maxZoom: 15, animate: true });
  } else {
    flyToGuarded([7.3349, -2.3268], 12); // Sunyani default
  }
}

// ─── PIN CLICK MODE TOGGLE (was "Reset view") ─
// When popups are ENABLED (default), clicking a pin opens its room card and
// traces the route to the seeker's base, as before. When DISABLED, a pin click
// ONLY draws (or clears, on a second click) the route trace — useful when the
// card gets in the way of reading the map. The button that used to reset the
// camera now toggles between these two behaviours.
let popupsEnabled = true;
// Marker currently traced in trace-only mode (a second click on it clears).
let tracedMarker = null;
// Marker whose popup is open, so switching to trace-only mode can keep its
// trace on screen after closing the card.
let openPopupMarker = null;

function updatePopupModeBtn() {
  const btn = document.getElementById('mapPopupModeBtn');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(popupsEnabled));
  btn.title = popupsEnabled
    ? 'Popups on — click a pin to open its room card'
    : 'Trace only — click a pin to draw the route to your base';
  btn.innerHTML = `<i data-lucide="${popupsEnabled ? 'message-square' : 'route'}"></i>`;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

function togglePopupMode() {
  popupsEnabled = !popupsEnabled;
  updatePopupModeBtn();
  if (!popupsEnabled) {
    // Switching to trace-only: close any open card (its close handler wipes the
    // trace) and redraw that room's trace so the context is not lost.
    const m = openPopupMarker;
    if (m && m.isPopupOpen()) m.closePopup();
    if (m) { tracedMarker = m; drawTraceToBase(m); }
    showToast('Trace only — pins draw the route, no card', 'info', 2200);
  } else {
    // Back to popups: a trace-only line has no card anchored to it, so clear it
    // and let the next pin click open the card as usual.
    tracedMarker = null;
    clearTraceLine();
    showToast('Popups on — pins open the room card', 'info', 2200);
  }
}
window.togglePopupMode = togglePopupMode;

// ─── FULLSCREEN MAP ───────────────────────────
// Expand the map to fill the whole viewport and back. Implemented as a CSS class
// on #mapWrap rather than the Fullscreen API on purpose: the Fullscreen API is
// blocked in iframes (and some embedded browsers), and it would also hide the
// app's own map controls. A class is reliable everywhere and keeps our zoom /
// rotation / search-area controls usable while expanded.
//
// Leaflet renders against the container's CURRENT size, so once the wrap has
// grown we MUST tell it to re-measure, or the tiles stay cropped at the old size.
// Swap the fullscreen button's glyph between "expand" and "collapse".
// lucide REPLACES the <i data-lucide> we write with an <svg>, so on the second
// call there is no <i> left to re-scan via nodes:[btn] — we replace the whole
// button content and re-run createIcons for the button each time.
function updateFullscreenIcon(btn, on) {
  btn.innerHTML = `<i data-lucide="${on ? 'minimize-2' : 'maximize-2'}"></i>`;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

function toggleMapFullscreen() {
  const wrap = document.getElementById('mapWrap');
  const btn = document.getElementById('mapFullscreenBtn');
  if (!wrap) return;
  const on = !wrap.classList.contains('map-fullscreen-on');
  wrap.classList.toggle('map-fullscreen-on', on);
  document.body.classList.toggle('map-fullscreen-active', on);
  if (btn) {
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Exit fullscreen map' : 'Toggle fullscreen map';
    updateFullscreenIcon(btn, on);
  }
  // Re-measure after the browser has applied the new layout, then once more on a
  // tick in case the transition/repaint lands later (same pattern as ensureMap).
  const remeasure = () => mapInstance && mapInstance.invalidateSize({ animate: false });
  requestAnimationFrame(remeasure);
  setTimeout(remeasure, 120);
  setTimeout(remeasure, 320);
  // Opening fullscreen should not leave a stale "Search this area" offer showing.
  hideSearchAreaPill();
}

// Exposed for the inline onclick handlers in listings.html (the file is a classic
// script, so these are already global — made explicit here for clarity/robustness).
window.searchThisArea = searchThisArea;
window.recenterMap = recenterMap;
window.toggleMapFullscreen = toggleMapFullscreen;

// ─── MAP SCREEN EFFECTS ───────────────────────
// The browse map should read as a LIVE surface, not a static picture. This
// little state machine drives the overlay layer in listings.html (see the
// LIVING MAP block in css/style.css for what each class actually draws):
//
//   mapFxLoading()   — sweeping scan bar + spinner chip while results load.
//   mapFxSearch(kind)— expanding rings for a search/filter; a radar pulse for
//                      "Search this area"; the two are mutually exclusive.
//
// Everything here is presentation only: it never touches the camera, the
// markers or the data, so a paused/ignored effect can never break the map.
let fxTimer = null;          // clears the transient one-shot effects
let fxSearchToken = 0;       // supersedes a running search effect
function mapFxEl() { return document.getElementById('mapFx'); }

// The tiny status chip on the overlay ("Loading rooms…", "Scanning area…").
function setMapFxLabel(text) {
  const el = document.getElementById('mapLabel');
  if (el) el.textContent = text;
}

function mapFxLoading(on) {
  const fx = mapFxEl();
  const wrap = document.getElementById('mapWrap');
  if (fx) fx.classList.toggle('fx-loading', !!on);
  // The vignette lives on #mapSearch::after (see style.css) so it can never
  // fight Leaflet's pane stack for a z-index slot inside the map.
  if (wrap) wrap.classList.toggle('map-busy', !!on);
  if (on) setMapFxLabel('Loading rooms…');
}

// Play the one-shot search effect. `kind`:
//   'search' — a fresh search / filter: rings expand from the centre and the
//              map briefly "locks on".
//   'area'   — "Search this area": a single radar pulse, because the user is
//              already looking at the right place.
function mapFxSearch(kind = 'search') {
  clearTimeout(fxTimer);
  mapFxLoading(false);
  const fx = mapFxEl();
  if (!fx) return;
  // Drop any previous one-shot before starting the next, or the classes pile
  // up and the second search looks like it never played.
  fx.classList.remove('fx-searching', 'fx-focus', 'fx-area-search');
  setMapFxLabel(kind === 'area' ? 'Scanning this area…' : 'Scanning rooms…');
  // Force a reflow so removing and re-adding the class in the same tick still
  // restarts the keyframes (the classic "repeat animation does not replay").
  void fx.offsetWidth;
  const token = ++fxSearchToken;
  if (kind === 'area') {
    fx.classList.add('fx-area-search');
    fxTimer = setTimeout(() => { if (token === fxSearchToken) fx.classList.remove('fx-area-search'); }, 2000);
    return;
  }
  fx.classList.add('fx-searching', 'fx-focus');
  fxTimer = setTimeout(() => {
    if (token !== fxSearchToken) return;
    fx.classList.remove('fx-searching', 'fx-focus');
  }, 1400);
}

// A fresh search or filter: sweep while we wait, then a scan when it lands.
function mapFxFreshSearch() { mapFxLoading(true); }

// Mark the pin the user is actually acting on. Leaflet keeps a stable DOM node
// per marker (until the set is re-plotted), so the classes survive pans, zooms
// and rotations — they only vanish when the pin itself does.
let activePinnedIcon = null;
function markActivePin(marker) {
  if (activePinnedIcon) {
    activePinnedIcon.classList.remove('map-pin-live', 'map-pin-active');
    activePinnedIcon = null;
  }
  const icon = marker && marker.getElement && marker.getElement();
  if (!icon) return;
  icon.classList.add('map-pin-live', 'map-pin-active');
  activePinnedIcon = icon;
}

// The result landed: stop the loader and play the "new pins" beat.
function mapFxResults(kind = 'search') { mapFxSearch(kind); }

// ─── BASE ↔ ROOM TRACE LINE ───────────────────
// When a popup opens, draw a line from the pinned room to the seeker's daily
// base. We ask the server for a road-following route (OSRM) so the trace follows
// streets rather than cutting across buildings; if routing is unavailable we fall
// back to a straight dashed line so the relationship is still visible.
function clearTraceLine() {
  if (mapTraceLayer) mapTraceLayer.clearLayers();
  clearTimeout(tracePulseTimer);
}

// Draw the polylines + end anchors for a given set of [lat,lng] points.
//
// Three stacked strokes, outside in:
//   • a white casing      — separates the route from the tiles underneath,
//   • a soft teal glow    — gives the line a lit, "live" feel (map-trace-glow),
//   • an animated core    — dashes that FLOW in the room → base direction
//                           (map-trace-flow), so the line reads as a route you
//                           could travel rather than a static annotation.
function drawTracePath(points, isRoad) {
  L.polyline(points, {
    color: '#ffffff', weight: isRoad ? 7 : 5, opacity: isRoad ? 0.85 : 0.7, lineCap: 'round'
  }).addTo(mapTraceLayer);
  // Glow sits UNDER the core and is drawn with a fat, blurred stroke.
  L.polyline(points, {
    color: '#38d0de', weight: isRoad ? 10 : 8, opacity: .3, lineCap: 'round',
    className: 'map-trace-glow'
  }).addTo(mapTraceLayer);
  L.polyline(points, {
    color: '#0e7490', weight: isRoad ? 4 : 2.5, opacity: 1,
    lineCap: 'round',
    // The core ALWAYS animates. A road route already reads as a road, so its
    // flow is a little tighter; the straight fallback keeps bigger gaps so the
    // dashes stay legible.
    dashArray: isRoad ? '16 10' : '8 8',
    className: 'map-trace-flow'
  }).addTo(mapTraceLayer);
  // A travelling pulse: a short bright dash that runs the route on a loop,
  // which makes the direction unmistakable at a glance.
  startTracePulse(points);
}

// The travelling pulse is a polyline that nags Leaflet into redrawing its dash
// offset. Leaflet's SVG renderer does not re-render on its own, so we nudge the
// dash offset each tick and let CSS handle the smooth interpolation between.
let tracePulseTimer = null;
function startTracePulse(points) {
  clearTimeout(tracePulseTimer);
  if (!mapTraceLayer || !Array.isArray(points) || points.length < 2) return;
  const pulse = L.polyline(points, {
    color: '#ffffff', weight: 3, opacity: .9, lineCap: 'round',
    dashArray: '2 240'
  }).addTo(mapTraceLayer);
  let offset = 0;
  const step = () => {
    offset -= 6; // negative = travel in the points' order (room → base)
    const el = pulse.getElement && pulse.getElement();
    if (!el) return;
    el.style.strokeDashoffset = String(offset);
    // Looping the offset over the dash period keeps the numbers small and the
    // motion perfectly seamless (the pattern repeats every 242 units).
    if (offset < -242) offset = 0;
    tracePulseTimer = setTimeout(step, 90);
  };
  tracePulseTimer = setTimeout(step, 90);
}

// End anchors get a one-off "ping" so the eye is drawn to both ends. The ping
// is a CSS animation on the circleMarker's path (see map-trace-anchor-ping).
function pingTraceAnchor(layer) {
  const el = layer && layer.getElement && layer.getElement();
  if (!el) return;
  el.classList.add('map-trace-anchor-ping');
  setTimeout(() => el.classList.remove('map-trace-anchor-ping'), 1900);
}

function addTraceArrows() {
  // Arrowheads removed from trace line
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
  // The camera is NOT reframed just because a popup opened — moving it under the
  // user is the "opens then jumps off-screen" bug. BUT the base is often outside
  // the view (especially on a phone, where the map is only ~55vh tall): the trace
  // is then drawn entirely off-screen and the user sees nothing at all, which
  // reads as "the line was never drawn". So: draw first, then bring the WHOLE
  // trace into view only when an end is actually off-screen.

  // Anchor each end so the line reads as a connection between two places.
  // Each anchor is pinged once on creation, so both ends announce themselves
  // instead of the user having to hunt for where the line stops.
  const baseAnchor = L.circleMarker(base, {
    radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1
  }).bindTooltip('Your base location').addTo(mapTraceLayer);
  const roomAnchor = L.circleMarker(room, {
    radius: 5, color: '#fff', weight: 2, fillColor: '#0e7490', fillOpacity: 1
  }).bindTooltip('Room (approximate)').addTo(mapTraceLayer);
  pingTraceAnchor(baseAnchor);
  pingTraceAnchor(roomAnchor);

  // Stamp the request so a slow response for a popup the seeker already closed
  // (or replaced) cannot draw a stale route over the current one.
  const token = ++traceRequestToken;
  try {
    // Request the route room → base: OSRM returns geometry in request order,
    // so the polyline and arrows read room → base (the direction the user asked
    // for), keeping the right-hand-traffic offset on the correct side.
    const params = new URLSearchParams({
      from_lat: room.lat, from_lng: room.lng,
      to_lat: base.lat, to_lng: base.lng
    });
    const data = await api.get('/api/geo/route?' + params.toString());
    const coords = data?.route?.coords;
    if (token !== traceRequestToken) return; // superseded while we awaited
    if (Array.isArray(coords) && coords.length > 1) {
      // OSRM returned geometry in room → base order (that's how we requested
      // it), so the polyline and arrowheads read room → base and the
      // right-hand-traffic offset sits on the correct side of the road.
      drawTracePath(coords, true);
      revealTraceIfOffscreen(base, room);
      return;
    }
  } catch { /* fall through to the straight line */ }
  if (token !== traceRequestToken) return;
  drawTracePath([base, room], false);
  revealTraceIfOffscreen(base, room);
}

// If either end of the trace sits outside the current viewport, ease the camera
// out just far enough to show the whole line — then re-fit the open popup, so
// bringing the base into view cannot push the popup off-screen. When both ends
// are already visible (the usual desktop case) this does nothing at all, so the
// camera is never moved needlessly.
function revealTraceIfOffscreen(base, room) {
  if (!mapInstance) return;
  const view = mapInstance.getBounds();
  const offscreen = !view.contains(base) || !view.contains(room);
  if (!offscreen) return;
  fitBoundsGuarded(L.latLngBounds([base, room]).pad(0.25), { maxZoom: 15 });
  // fitBounds moves the map, which can slide the open popup past an edge.
  ensurePopupVisible();
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
    // Clicking "Map" is an explicit "show me the results on the map", so it
    // reframes even if the map had been panned before.
    beginFreshSearch();
    // Re-run the opening cinematic every time the map view is entered — not
    // just on first creation — so switching away and back zooms into Sunyani
    // again. ensureMap() plays it once the container is measured, and the
    // introFlyUntil window stops result-framing from cutting the flight short.
    pendingIntroFly = true;
    // Entering the map is itself a "fresh search": a scan sweep plays over it so
    // the switch reads as the map coming alive, not a static panel appearing.
    mapFxFreshSearch();
    // If data hasn't arrived yet (user clicked Map immediately), load it —
    // loadListings() renders the map once the rooms come back.
    if (lastFetchedListings.length) {
      renderMapListings(true);
      // The intro fly-in lasts ~2.2s; hold the scan until it has landed, or the
      // effect plays over a moving camera and reads as noise.
      setTimeout(() => { if (currentView === 'map') mapFxResults('search'); }, 900);
    } else {
      loadListings();
    }
  } else {
    // Leaving the map drops any area search and Near Base so the grid shows the
    // full result set again, the way Google Maps keeps list and map scopes
    // independent.
    setMapEmptyState(false);
    // Stop any running effect: the overlays are hidden with the map, but a live
    // timer would still be ticking against a hidden container.
    mapFxLoading(false);
    clearTimeout(fxTimer);
    if (nearMeKm) { nearMeLat = null; nearMeLng = null; nearMeKm = null; }
    mapAreaScope = null;
    setNearMeBtnState(document.getElementById('nearMeBtn'), false);
    // Never leave the page stuck in fullscreen map mode when the map itself is
    // being switched away — the grid must be reachable.
    const fsWrap = document.getElementById('mapWrap');
    if (fsWrap && fsWrap.classList.contains('map-fullscreen-on')) toggleMapFullscreen();
    loadListings();
  }
}

// Escape exits fullscreen map mode (standard expectation for a fullscreen view).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const wrap = document.getElementById('mapWrap');
  if (wrap && wrap.classList.contains('map-fullscreen-on')) toggleMapFullscreen();
});

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
  let verified = null;
  try {
    verified = await initNavAuth();
    if (verified?.role) role = verified.role;
  } catch { /* fall back to the cached role */ }

  if (['owner', 'agent', 'admin'].includes(role)) {
    setUpOwnerView();
    loadOwnerListingsView();
    if (window.renderFooterNav) window.renderFooterNav();
  } else {
    // Fetch the seeker's daily base location once — used for distance/time lines
    // and the base↔room trace. REUSE the fresh user initNavAuth() already fetched
    // instead of calling /api/auth/me a second time: the auth rate limiter counts
    // both, and the double call was burning the 20-requests-per-15-minutes budget
    // in half on every page load. When a phone hits that limit (or is briefly
    // offline), fall back to the cached user so the trace still has a base —
    // better a slightly stale base than no trace line at all.
    const base = (verified && verified.base_lat && verified.base_lng)
      ? { lat: verified.base_lat, lng: verified.base_lng }
      : (() => {
          try {
            const c = JSON.parse(localStorage.getItem('user') || 'null');
            return (c && c.base_lat && c.base_lng) ? { lat: c.base_lat, lng: c.base_lng } : null;
          } catch { return null; }
        })();
    if (base) window.__userBaseLoc = base;
    loadListings();
  }
})();
