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

  async upload(url, formData, method = 'POST') {
    const token = api.getToken();
    const res = await fetch(url, {
      method,
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (res.status === 401 && token) {
      signOutAndRedirect(data.error || 'Your session has ended. Please log in again.');
    }
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

// ─── SIDEBAR: CLOSE WHEN CLICKING OUTSIDE ─────────────────────
// Wires a document-level listener so that a click anywhere outside the side
// panel collapses it — not only on the dimmed backdrop. The backdrop covers the
// viewport behind the mobile drawer, but clicks that land on the page content
// (or on desktop layout) bypass it; this catches those.
//
// options:
//   sidebarId  id of the <aside> panel itself
//   isOpen     () => boolean — whether the panel is currently open
//   onOutside  () => void    — collapse it
function closeSidebarOnOutsideClick({ sidebarId, isOpen, onOutside }) {
  const sidebar = document.getElementById(sidebarId);
  if (!sidebar) return;
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;                 // nothing to close
    if (sidebar.contains(e.target)) return; // click landed inside the panel
    // Ignore the toggle buttons: their own handlers flip the panel, and closing
    // here too would immediately undo the open they just performed. `closest`
    // alone misses clicks that land on the inner <svg>/<i> icon, so also test
    // the button elements directly with contains().
    const toggles = document.querySelectorAll('#sidebarMobileToggle, #sidebarToggle');
    for (const t of toggles) {
      if (t === e.target || t.contains(e.target)) return;
    }
    onOutside();
  });
}

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
function setNavAuth(loggedIn, role) {
  const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = ''; };
  const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  if (loggedIn) {
    // Seekers see "Profile" in the top nav; owners/agents/admins keep "Dashboard".
    const navLabel = role === 'seeker' ? 'Profile' : 'Dashboard';
    ['dashboardBtn', 'dashboardBtnMobile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = navLabel;
    });
    hide('loginBtn'); hide('signupBtn'); hide('loginBtnMobile'); hide('signupBtnMobile');
    show('dashboardBtn'); show('logoutBtn'); show('dashboardBtnMobile'); show('logoutBtnMobile');
  } else {
    hide('dashboardBtn'); hide('logoutBtn'); hide('dashboardBtnMobile'); hide('logoutBtnMobile');
    show('loginBtn'); show('signupBtn'); show('loginBtnMobile'); show('signupBtnMobile');
  }
}

async function initNavAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    localStorage.removeItem('user');
    setNavAuth(false);
    applyRoleToLogo(null);
    return null;
  }
  try {
    const { user } = await api.get('/api/auth/me');
    localStorage.setItem('user', JSON.stringify(user));
    setNavAuth(true, user?.role);
    applyRoleToLogo(user?.role);
    return user;
  } catch {
    // A transient failure (offline, 429 rate-limit, 5xx) must NOT log the user
    // out — only a real auth rejection may do that, and a 401 has already been
    // handled by api.request -> signOutAndRedirect before we ever get here.
    // Previously this cleared the token, so hitting the auth rate limit (or a
    // flaky mobile connection) silently signed people out; anything that reads
    // the user afterwards (e.g. the map's base-location trace) lost their data.
    const cached = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; } })();
    setNavAuth(!!(cached && localStorage.getItem('token')), cached?.role);
    applyRoleToLogo(cached?.role || null);
    return cached;
  }
}

function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  applyRoleToLogo(null);
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
  applyRoleToLogo(null);
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

// Point the top-bar logo at the viewer's role-specific home page. Every page's
// logo is authored as href="/" (the visitor home), so without this a logged-in
// seeker/owner clicking it from /listings, /about, etc. would be dropped on the
// visitor page. Called once the role is known (see initNavAuth) so it always
// reflects the CURRENT user, and reset to "/" on logout.
function applyRoleToLogo(role) {
  const target = role ? goHomeForRole(role) : '/';
  document.querySelectorAll('a.logo').forEach(a => { a.setAttribute('href', target); });
}
window.applyRoleToLogo = applyRoleToLogo;

// ─── DISTANCE FROM DAILY BASE LOCATION ───────────────────────────────────────
// window.__userBaseLoc is set by listings.js once /api/auth/me returns the
// seeker's daily base location. When present, cards show straight-line distance
// with estimated walking / driving times.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Rough travel estimates for straight-line distance. Walking ~5 km/h with a
// 1.25 road-factor; driving ~30 km/h average city speed in Ghana with 1.4 factor.
function estimateTravel(km) {
  const walkMin = Math.round((km * 1.25 / 5) * 60);
  const driveMin = Math.round((km * 1.4 / 30) * 60) + 1;
  const fmt = m => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
  const dist = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  return { dist, walk: fmt(walkMin), drive: fmt(driveMin) };
}

// Renders the "from your base location" line, or '' when no base is known.
function renderDistanceLine(l) {
  const b = window.__userBaseLoc;
  if (!b || !b.lat || !b.lng || !l.location_lat || !l.location_lng) return '';
  const km = haversineKm(b.lat, b.lng, l.location_lat, l.location_lng);
  if (km > 100) return ''; // base location probably unrelated to search area
  const t = estimateTravel(km);
  return `<div class="card-distance"><i data-lucide="route"></i> <span>${t.dist} from your base · ~${t.walk} walk · ~${t.drive} drive</span></div>`;
}

// ─── LISTING CARD RENDERER ────────────────────────────────────────────────────
function renderListingCard(l, options = {}) {
  const isPopup = options && options.isPopup;
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

  // Amenities are excluded from map popup cards to keep them sleek, focused, and clean
  const amenitiesHtml = isPopup ? '' : `<div class="amenity-icons">${amenityIcons.map(a => `<span class="amenity-icon">${a}</span>`).join('')}</div>`;

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
        ${renderDistanceLine(l)}
        ${amenitiesHtml}
      </div>
      <div class="card-footer">
        <div>
          <div class="card-price">GHS ${Number(l.price_per_head).toLocaleString()}</div>
          ${perHead}
        </div>
        <span class="tag"><i data-lucide="users" style="width:12px;height:12px;margin-right:2px"></i> ${l.occupancy_type}-in-1</span>
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
