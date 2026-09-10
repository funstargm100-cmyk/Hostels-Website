// ─── BACK NAVIGATION ─────────────────────────────────────────────────────────
function goBack(fallback = '/') {
  if (history.length > 1 && document.referrer && document.referrer !== location.href) {
    history.back();
  } else {
    location.href = fallback;
  }
}

// ─── API HELPER ───────────────────────────────────────────────────────────────
const api = {
  getToken: () => localStorage.getItem('token'),

  async request(method, url, body) {
    const token = api.getToken();
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (res.status === 401 && token) {
      // Session is no longer valid (deleted account, logged out elsewhere, expired token) —
      // fully sign out client-side and drop the user on the public visitor homepage.
      signOutAndRedirect(data.error || 'Your session has ended. Please log in again.');
    }
    if (!res.ok) { const err = new Error(data.error || 'Request failed'); Object.assign(err, data); throw err; }
    return data;
  },
  get: (url) => api.request('GET', url),
  post: (url, body) => api.request('POST', url, body),
  put: (url, body) => api.request('PUT', url, body),
  delete: (url) => api.request('DELETE', url),

  async upload(url, formData) {
    const token = api.getToken();
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  }
};

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const iconMap = { success: 'check-circle', error: 'x-circle', info: 'info', warning: 'alert-triangle' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i data-lucide="${iconMap[type]}" style="width:16px;height:16px;flex-shrink:0"></i><span>${message}</span>`;
  container.appendChild(toast);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [toast] });
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
  if (btn) btn.innerHTML = saved === 'dark' ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.innerHTML = next === 'dark' ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

// ─── NAVBAR AUTH STATE ────────────────────────────────────────────────────────
function setNavAuth(loggedIn) {
  const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  if (loggedIn) {
    hide('loginBtn'); hide('signupBtn'); hide('loginBtnMobile'); hide('signupBtnMobile');
    show('dashboardBtn'); show('logoutBtn'); show('dashboardBtnMobile'); show('logoutBtnMobile');
  } else {
    hide('dashboardBtn'); hide('logoutBtn'); hide('dashboardBtnMobile'); hide('logoutBtnMobile');
    show('loginBtn'); show('signupBtn'); show('loginBtnMobile'); show('signupBtnMobile');
  }
}

async function initNavAuth() {
  const token = localStorage.getItem('token');
  if (!token) { localStorage.removeItem('user'); setNavAuth(false); return null; }
  try {
    const { user } = await api.get('/api/auth/me');
    localStorage.setItem('user', JSON.stringify(user));
    setNavAuth(true);
    return user;
  } catch {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    setNavAuth(false);
    return null;
  }
}

function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  location.href = '/';
}

// Force sign-out when the server rejects the session (e.g. the account was
// deleted by an admin). Clears state, updates the nav, notifies and redirects.
let signingOut = false;
function signOutAndRedirect(message) {
  if (signingOut) return;
  signingOut = true;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  setNavAuth(false);
  if (window.renderFooterNav) window.renderFooterNav();
  showToast(message, 'warning');
  setTimeout(() => { location.href = '/'; }, 1200);
}
window.signOutAndRedirect = signOutAndRedirect;

// Send each role to its own dedicated home page
function goHomeForRole(role) {
  if (role === 'admin') return '/admin';
  if (role === 'owner' || role === 'agent') return '/home-agent';
  if (role === 'seeker') return '/home-seeker';
  return '/';
}
window.goHomeForRole = goHomeForRole;
document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
document.getElementById('logoutBtnMobile')?.addEventListener('click', handleLogout);

// ─── LISTING CARD RENDERER ────────────────────────────────────────────────────
function renderListingCard(l) {
  const img = l.primary_image ? l.primary_image : '/images/placeholder.jpg';
  const verified = l.owner_verified ? '<span class="badge badge-verified"><i data-lucide="badge-check" style="width:11px;height:11px"></i> Verified</span>' : '';
  const featured = l.is_featured ? '<span class="badge badge-featured"><i data-lucide="star" style="width:11px;height:11px"></i> Featured</span>' : '';
  const perHead = `<div class="card-price-sub">per&nbsp;person</div>`;
  const amenityIcons = [
    l.wifi ? '<i data-lucide="wifi"></i> Wi-Fi' : '',
    l.water === 'constant' ? '<i data-lucide="droplets"></i> Water' : '',
    l.parking ? '<i data-lucide="car"></i> Parking' : '',
    l.furnishing === 'furnished' ? '<i data-lucide="armchair"></i> Furnished' : ''
  ].filter(Boolean).slice(0, 3);

  // Short location, e.g. "New Town, Sunyani Mun..." — first two comma parts
  const locParts = String(l.location_area || '').split(',').map(s => s.trim()).filter(Boolean);
  const locText = locParts.slice(0, 2).join(', ');

  return `
    <div class="card" onclick="location.href='/listing?id=${l.uuid}'" style="cursor:pointer">
      <div style="position:relative">
        <img class="card-img" src="${img}" alt="${l.title}" loading="lazy" onerror="this.onerror=null;this.src='/images/placeholder.jpg'" />
        <div style="position:absolute;top:0.6rem;left:0.6rem;display:flex;gap:0.3rem;flex-wrap:wrap">${verified}${featured}</div>
        <button class="fav-btn" style="position:absolute;top:0.5rem;right:0.5rem;background:rgba(255,255,255,0.9);border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center"
          onclick="event.stopPropagation();toggleFav('${l.uuid}',this)"><i data-lucide="heart"></i></button>
      </div>
      <div class="card-body">
        <div class="card-title">${l.title}</div>
        <div class="card-location"><i data-lucide="map-pin"></i> <span>${locText}</span></div>
        <div class="amenity-icons">${amenityIcons.map(a => `<span class="amenity-icon">${a}</span>`).join('')}</div>
      </div>
      <div class="card-footer">
        <div>
          <div class="card-price">GHS ${Number(l.price_per_head).toLocaleString()}</div>
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
    btn.innerHTML = favorited ? '<i data-lucide="heart" style="width:20px;height:20px;fill:var(--primary);color:var(--primary)"></i>' : '<i data-lucide="heart" style="width:20px;height:20px"></i>';
    btn.classList.toggle('active', favorited);
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
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
