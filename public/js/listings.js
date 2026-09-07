let currentPage = 1;
let currentView = 'grid';
let nearMeLat = null;
let nearMeLng = null;

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
    renderPagination(data.page, data.pages);
  } catch (e) {
    grid.innerHTML = `<p class="text-muted">Failed to load listings: ${e.message}</p>`;
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
function applyFilters() { currentPage = 1; loadListings(); }
function clearFilters() {
  document.getElementById('searchLocation').value = '';
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
function setView(v) { currentView = v; loadListings(); }

// Pre-fill from URL params
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('location')) document.getElementById('searchLocation').value = urlParams.get('location');
if (urlParams.get('max_price')) document.getElementById('maxPrice').value = urlParams.get('max_price');
if (urlParams.get('occupancy')) {
  const radio = document.querySelector(`input[name="occupancy"][value="${urlParams.get('occupancy')}"]`);
  if (radio) radio.checked = true;
}

loadListings();
