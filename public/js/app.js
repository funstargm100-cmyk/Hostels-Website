// ─── API HELPER ───────────────────────────────────────────────────────────────
const api = {
  async request(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },
  get: (url) => api.request('GET', url),
  post: (url, body) => api.request('POST', url, body),
  put: (url, body) => api.request('PUT', url, body),
  delete: (url) => api.request('DELETE', url),

  async upload(url, formData) {
    const res = await fetch(url, { method: 'POST', body: formData, credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  }
};

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'none'; toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, duration);
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

// ─── THEME ────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}
document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

// ─── NAVBAR AUTH STATE ────────────────────────────────────────────────────────
async function initNavAuth() {
  try {
    const { user } = await api.get('/api/auth/me');
    localStorage.setItem('user', JSON.stringify(user));
    document.getElementById('loginBtn')?.style && (document.getElementById('loginBtn').style.display = 'none');
    document.getElementById('signupBtn')?.style && (document.getElementById('signupBtn').style.display = 'none');
    document.getElementById('dashboardBtn')?.style && (document.getElementById('dashboardBtn').style.display = '');
    document.getElementById('logoutBtn')?.style && (document.getElementById('logoutBtn').style.display = '');
    return user;
  } catch {
    localStorage.removeItem('user');
    document.getElementById('dashboardBtn')?.style && (document.getElementById('dashboardBtn').style.display = 'none');
    document.getElementById('logoutBtn')?.style && (document.getElementById('logoutBtn').style.display = 'none');
    return null;
  }
}

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await api.post('/api/auth/logout');
  localStorage.removeItem('user');
  location.href = '/';
});

// ─── HAMBURGER ────────────────────────────────────────────────────────────────
document.getElementById('hamburger')?.addEventListener('click', () => {
  document.getElementById('navMenu')?.classList.toggle('open');
});

// ─── LISTING CARD RENDERER ────────────────────────────────────────────────────
function renderListingCard(l) {
  const img = l.primary_image ? l.primary_image : '/images/placeholder.jpg';
  const verified = l.owner_verified ? '<span class="badge badge-verified">✓ Verified</span>' : '';
  const featured = l.is_featured ? '<span class="badge badge-featured">⭐ Featured</span>' : '';
  const stars = l.avg_rating ? `<span class="stars">${'★'.repeat(Math.round(l.avg_rating))}${'☆'.repeat(5 - Math.round(l.avg_rating))}</span> ${l.avg_rating} (${l.review_count})` : 'No reviews';
  const perHead = l.occupancy_type > 1 ? `<div class="card-price-sub">GHS ${Number(l.price_per_head).toLocaleString()} / person</div>` : '';
  const amenityIcons = [
    l.wifi ? '📶 Wi-Fi' : '',
    l.water === 'constant' ? '💧 Water' : '',
    l.parking ? '🚗 Parking' : '',
    l.furnishing === 'furnished' ? '🛋️ Furnished' : ''
  ].filter(Boolean).slice(0, 3);

  return `
    <div class="card" onclick="location.href='/listing?id=${l.uuid}'" style="cursor:pointer">
      <div style="position:relative">
        <img class="card-img" src="${img}" alt="${l.title}" loading="lazy" onerror="this.src='/images/placeholder.jpg'" />
        <div style="position:absolute;top:0.6rem;left:0.6rem;display:flex;gap:0.3rem;flex-wrap:wrap">${verified}${featured}</div>
        <button class="fav-btn" style="position:absolute;top:0.5rem;right:0.5rem;background:rgba(255,255,255,0.9);border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center"
          onclick="event.stopPropagation();toggleFav('${l.uuid}',this)">🤍</button>
      </div>
      <div class="card-body">
        <div class="card-title">${l.title}</div>
        <div class="card-location">📍 ${l.location_area}${l.nearest_landmark ? ' · ' + l.nearest_landmark : ''}</div>
        <div class="star-rating">${stars}</div>
        <div class="amenity-icons">${amenityIcons.map(a => `<span class="amenity-icon">${a}</span>`).join('')}</div>
      </div>
      <div class="card-footer">
        <div>
          <div class="card-price">GHS ${Number(l.listed_price).toLocaleString()}</div>
          ${perHead}
        </div>
        <span class="tag">${l.occupancy_type}-in-1</span>
      </div>
    </div>`;
}

async function toggleFav(uuid, btn) {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) return location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
  try {
    const { favorited } = await api.post(`/api/listings/${uuid}/favorite`);
    btn.textContent = favorited ? '❤️' : '🤍';
    btn.classList.toggle('active', favorited);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderSkeletons(container, count = 4) {
  container.innerHTML = Array(count).fill(`
    <div class="skeleton-card">
      <div class="skeleton skeleton-img"></div>
      <div style="padding:1rem">
        <div class="skeleton skeleton-text w-80"></div>
        <div class="skeleton skeleton-text w-60 mt-1"></div>
        <div class="skeleton skeleton-text w-40 mt-1"></div>
      </div>
    </div>`).join('');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
initTheme();
initNavAuth();
