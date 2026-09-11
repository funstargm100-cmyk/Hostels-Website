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
let lastFetchedListings = [];

function ensureMap() {
  const el = document.getElementById('mapSearch');
  if (!el) return null;
  if (!mapInstance) {
    mapInstance = L.map(el, { scrollWheelZoom: true }).setView([5.6037, -0.1870], 12); // Accra default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance);
    mapMarkersLayer = L.layerGroup().addTo(mapInstance);
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
  const b = window.__userBaseLoc;
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
    const marker = L.marker([lat, lng]).addTo(mapMarkersLayer);
    marker.bindPopup(() => renderListingCard(l, { isPopup: true }), { maxWidth: 280, minWidth: 240, autoPanPadding: [16, 16] });
  });
  // Popup content is injected lazily by Leaflet, so icons rendered inside it
  // (the distance "route" icon, map-pin, etc.) never got lucide.createIcons()
  // applied. Initialize them the moment a popup opens — previously they only
  // appeared after another action (e.g. tapping the like button) re-ran
  // createIcons across the page.
  map.off('popupopen').on('popupopen', (e) => {
    const el = e.popup.getElement();
    if (el && typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
  });
  if (pts.length) {
    map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 15 });
    // If we know the user's base location, draw it as a reference point.
    if (b?.lat && b?.lng) {
      L.circleMarker([b.lat, b.lng], { radius: 7, color: '#2563eb', fillOpacity: 1 })
        .bindTooltip('Your base location')
        .addTo(mapMarkersLayer);
    }
  }
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
