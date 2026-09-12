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
function applyFilters() { currentPage = 1; beginFreshSearch(); loadListings(); closeFilters(); }
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
let lastFetchedListings = [];
// True while WE move the camera (fitBounds/flyTo), so the moveend/zoomend
// handlers can tell our programmatic moves apart from a genuine user pan/zoom.
let suppressMoveEvent = false;
// Map rotation lock state for the bottom-left rotation knob. UNLOCKED by default
// on both desktop and mobile; clicking the knob toggles it.
let mapRotationLocked = false;
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
    }).setView([5.6037, -0.1870], 12); // Accra default
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
    // DRAG: pointer movement around the knob's centre sets the map bearing.
    // CLICK: a short press with no drag toggles the rotation lock — when locked,
    // dragging the knob (and the ← / → keys) does nothing. Unlocked by default.
    function initRotateKnob() {
      const knob = document.getElementById('mapRotateKnob');
      if (!knob || typeof mapInstance.setBearing !== 'function') return;
      let dragging = false, moved = false, startBearing = 0, startAngle = 0;
      const angleAt = (e) => {
        const r = knob.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        return Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
      };
      const setLocked = (locked) => {
        mapRotationLocked = locked;
        knob.dataset.locked = String(locked);
        knob.title = locked ? 'Rotation locked — click to unlock' : 'Drag to rotate — click to lock';
        showToast(locked ? 'Map rotation locked' : 'Map rotation unlocked', 'info', 1600);
      };
      knob.addEventListener('pointerdown', (e) => {
        if (mapRotationLocked) { e.preventDefault(); return; }
        dragging = true; moved = false;
        startBearing = mapInstance.getBearing?.() || 0;
        startAngle = angleAt(e);
        knob.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      knob.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const delta = angleAt(e) - startAngle;
        if (Math.abs(delta) < 4 && !moved) return; // dead-zone so a click stays a click
        moved = true;
        // Damping: 1px at the knob's edge was producing ~2° of map rotation — far
        // too twitchy for a mouse. Scale the raw angle down and apply exponential
        // smoothing so the bearing glides instead of snapping.
        const target = startBearing - delta * 0.35;
        const current = mapInstance.getBearing?.() || 0;
        let smoothed = current + (target - current) * 0.35;
        smoothed = ((smoothed % 360) + 360) % 360;
        suppressMoveEvent = true;
        mapInstance.setBearing(smoothed);
        suppressMoveEvent = false;
        const icon = knob.querySelector('svg, i');
        if (icon) icon.style.transform = `rotate(${smoothed}deg)`;
      });
      const endDrag = () => { dragging = false; };
      knob.addEventListener('pointerup', endDrag);
      knob.addEventListener('pointercancel', endDrag);
      knob.addEventListener('click', () => {
        if (moved) { moved = false; return; } // it was a drag, not a click
        setLocked(!mapRotationLocked);
      });
      // Keep the knob glyph pointing north as the map rotates by any means.
      mapInstance.on('rotate', () => {
        const icon = knob.querySelector('svg, i');
        if (icon) icon.style.transform = `rotate(${mapInstance.getBearing?.() || 0}deg)`;
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
  }
  // The container may have been hidden (display:none) until now — Leaflet
  // computes bounds against the CURRENT container size, so it MUST be resized
  // and repainted BEFORE markers/fitBounds run, or the view collapses and
  // markers appear missing. Invalidate now and once more after a repaint tick.
  mapInstance.invalidateSize();
  setTimeout(() => mapInstance && mapInstance.invalidateSize(), 80);
  return mapInstance;
}

// Escape a listing title before it goes into a marker's HTML label. Titles are
// user-supplied, so a stray < or & must not become markup.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  // The user explicitly asked to re-frame on the results, so this is now "our"
  // camera position, not theirs — a later re-render may re-fit again.
  userHasMovedMap = false;
  const pts = lastFetchedListings
    .map(l => [parseFloat(l.display_lat), parseFloat(l.display_lng)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length) {
    fitBoundsGuarded(L.latLngBounds(pts).pad(0.25), { maxZoom: 15, animate: true });
  } else {
    flyToGuarded([5.6037, -0.1870], 12); // Accra default
  }
}

// Reset the map view in one click: bearing back to north, then re-frame the
// results bounding box (which also re-centers and re-zooms). One click undoes
// any rotation, panning and zooming the user has done.
function resetMapView() {
  if (!mapInstance || typeof mapInstance.setBearing !== 'function') return recenterMap();
  suppressMoveEvent = true;
  mapInstance.setBearing(0);
  suppressMoveEvent = false;
  recenterMap();
  showToast('View reset', 'info', 1400);
}
window.resetMapView = resetMapView;

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

// ─── BASE ↔ ROOM TRACE LINE ───────────────────
// When a popup opens, draw a line from the pinned room to the seeker's daily
// base. We ask the server for a road-following route (OSRM) so the trace follows
// streets rather than cutting across buildings; if routing is unavailable we fall
// back to a straight dashed line so the relationship is still visible.
function clearTraceLine() {
  if (mapTraceLayer) mapTraceLayer.clearLayers();
}

// Draw the polylines + end anchors for a given set of [lat,lng] points.
// Directional arrowheads are added along the path so the travel direction (base
// → room) is explicit — without them a bare line reads as "which way am I going
// again?", and on a two-way road the eye picks the wrong direction half the time.
// Arrows are nudged to the RIGHT of the line to match Ghana's right-hand traffic.
function drawTracePath(points, isRoad) {
  L.polyline(points, {
    color: '#ffffff', weight: isRoad ? 7 : 5, opacity: isRoad ? 0.85 : 0.7, lineCap: 'round'
  }).addTo(mapTraceLayer);
  L.polyline(points, {
    color: '#0e7490', weight: isRoad ? 4 : 2.5, opacity: 1,
    dashArray: isRoad ? null : '8 8', lineCap: 'round'
  }).addTo(mapTraceLayer);
  addTraceArrows(points);
}

// Place chevron arrowheads every ~10% of the path length, rotated to the local
// heading, and offset perpendicular to the RIGHT of travel (Ghana drives on the
// right, so the offset side also hints at the correct lane).
function addTraceArrows(points) {
  if (!Array.isArray(points) || points.length < 2) return;
  // Walk the polyline and keep segment bearings so each arrow points along the
  // road it sits on, not the straight base→room chord.
  const total = points.reduce((sum, p, i) =>
    i ? sum + L.latLng(points[i - 1]).distanceTo(L.latLng(p)) : 0, 0);
  if (total < 300) return; // too short for arrows to be readable
  const spacing = total / Math.min(6, Math.max(2, Math.round(total / 4000)));
  let placed = 0, next = spacing * 0.6;
  for (let i = 1; i < points.length && placed < 8; i++) {
    const a = L.latLng(points[i - 1]), b = L.latLng(points[i]);
    const segLen = a.distanceTo(b);
    while (next <= segLen && placed < 8) {
      const frac = next / segLen;
      const mid = L.latLng(a.lat + (b.lat - a.lat) * frac, a.lng + (b.lng - a.lng) * frac);
      // Bearing of the segment (direction of travel). Perpendicular offset of
      // ~8 px-equivalent (~6 m at city zoom) to the right: rotate bearing +90°.
      const bearing = Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180 / Math.PI;
      const right = (bearing + 90) * Math.PI / 180;
      const offs = 0.00008;
      const pos = L.latLng(mid.lat + Math.cos(right) * offs, mid.lng + Math.sin(right) * offs);
      L.marker(pos, {
        icon: L.divIcon({
          className: 'trace-arrow',
          html: '<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(' + bearing + 'deg)">' +
                '<path d="M8 2 L13 11 L8 8.5 L3 11 Z" fill="#0e7490" stroke="#ffffff" stroke-width="1"/></svg>',
          iconSize: [16, 16], iconAnchor: [8, 8], interactive: false
        }),
        keyboard: false, zIndexOffset: -200
      }).addTo(mapTraceLayer);
      placed++;
      next += spacing;
    }
    next -= segLen;
  }
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
    // If data hasn't arrived yet (user clicked Map immediately), load it —
    // loadListings() renders the map once the rooms come back.
    if (lastFetchedListings.length) renderMapListings(true);
    else loadListings();
  } else {
    // Leaving the map drops any area search so the grid shows the full result
    // set again, the way Google Maps keeps list and map scopes independent.
    if (nearMeKm) { nearMeLat = null; nearMeLng = null; nearMeKm = null; }
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
