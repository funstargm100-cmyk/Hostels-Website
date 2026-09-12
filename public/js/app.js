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
// ─── CLIENT-SIDE IMAGE COMPRESSION ───────────────────────────
// Resize + re-encode photos IN THE BROWSER before they are uploaded.
//
// Why this exists: the server already converts uploads to WebP (see
// src/utils/imageStorage.js), but that happens AFTER the request body has been
// received. A phone photo is routinely 4-8MB, and the post-ad form sends up to
// 10 of them in ONE multipart request — easily 40-80MB. Serverless platforms cap
// the request body (Vercel: ~4.5MB) and reject it with FUNCTION_PAYLOAD_TOO_LARGE
// before any of our code runs, so the server-side compression is never reached.
// Compressing here keeps the whole body small enough to be accepted at all.
//
// The output is JPEG rather than WebP: canvas.toBlob('image/webp') is only
// supported in Chromium, and silently falls back to PNG elsewhere (which can be
// LARGER than the original). JPEG is universally encodable and, at these sizes
// and qualities, indistinguishable on a listing card.
const IMAGE_UPLOAD = {
  maxDim: 1600,            // longest edge, matching the server's own target
  quality: 0.82,           // starting JPEG quality
  minQuality: 0.5,         // never push below this — visible artefacts
  // Per-photo byte budget, and it MUST be chosen against the WHOLE-body limit,
  // not per file. Measured reality: a busy 4032x3024 photo compresses to ~700KB
  // at these settings, so 10 of them is ~7MB — comfortably over the ~4.5MB that
  // serverless platforms accept for the entire request, which is the exact error
  // we are trying to prevent. 360KB x 10 = ~3.6MB, leaving headroom for the
  // form fields and multipart boundaries.
  targetBytes: 360000,
  // The absolute ceiling for ONE file. Beyond this we keep lowering quality, and
  // if the image still refuses to shrink we send the best attempt rather than
  // fail: a slightly-too-large photo the server can still handle beats a blocked
  // submit.
  hardBytes: 900000
};

// Downscale + re-encode ONE image file. Always resolves with a File — on any
// failure (unsupported codec, canvas unavailable, a corrupt image) it resolves
// with the ORIGINAL file, so compression can never be the reason an upload
// breaks. Returns { file, originalSize, size, ratio, skipped }.
async function compressImage(file, opts = {}) {
  const cfg = Object.assign({}, IMAGE_UPLOAD, opts);
  const fail = (skipped) => ({ file, originalSize: file.size, size: file.size, ratio: 1, skipped });

  // Only images, and nothing already small enough to be worth the CPU.
  if (!file || !file.type || file.type.indexOf('image/') !== 0) return fail('not-an-image');
  if (file.size < 250000) return fail('already-small');
  // GIFs may be animated and SVG is vector: canvas would destroy both.
  if (/image\/(gif|svg\+xml)/.test(file.type)) return fail('unsupported-type');

  // Decode. createImageBitmap is much faster and off-main-thread where available;
  // the <img> + object URL path is the fallback for older Safari.
  let source = null;
  let revoke = null;
  try {
    if (typeof createImageBitmap === 'function') {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } else {
      const url = URL.createObjectURL(file);
      revoke = url;
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
        img.src = url;
      });
    }
  } catch (e) {
    if (revoke) URL.revokeObjectURL(revoke);
    return fail('decode-failed');
  }

  const srcW = source.width || source.naturalWidth;
  const srcH = source.height || source.naturalHeight;
  if (!srcW || !srcH) { if (revoke) URL.revokeObjectURL(revoke); return fail('no-dimensions'); }

  // Scale so the LONGEST edge is maxDim (never upscale — that would inflate).
  const scale = Math.min(1, cfg.maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  // Draw at the target size with high-quality smoothing. A single large step
  // (e.g. 4000px -> 1600px) would drop pixels rather than average them and look
  // aliased; imageSmoothingQuality:'high' makes the browser resample properly.
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { if (revoke) URL.revokeObjectURL(revoke); return fail('no-canvas'); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  if (source.close) source.close();
  if (revoke) URL.revokeObjectURL(revoke);

  // Encode, lowering quality in steps until the file is small enough.
  const toBlob = (q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
  let quality = cfg.quality;
  let outBlob = null;
  // More steps than strictly needed, so the loop lands close to the target
  // instead of overshooting to the quality floor and giving up detail for free.
  for (let i = 0; i < 9; i++) {
    outBlob = await toBlob(quality);
    if (!outBlob) break;
    if (outBlob.size <= cfg.targetBytes || quality <= cfg.minQuality) break;
    quality = Math.max(cfg.minQuality, quality - 0.06);
  }
  if (!outBlob) return fail('encode-failed');

  // If the quality ladder ran out and it is STILL too big, shrink the pixels
  // instead. Dropping the long edge is far less destructive than crushing the
  // quality further, and this is what actually saves very detailed images (foliage,
  // fabric, text on a wall) that resist JPEG compression. Loops, because one
  // halving may not be enough on a pathological image.
  let curW = w, curH = h;
  for (let pass = 0; pass < 3 && outBlob.size > cfg.hardBytes && Math.max(curW, curH) > 640; pass++) {
    const shrink = Math.max(0.6, Math.sqrt(cfg.hardBytes / outBlob.size));
    const w2 = Math.max(1, Math.round(curW * shrink));
    const h2 = Math.max(1, Math.round(curH * shrink));
    const c2 = document.createElement('canvas');
    c2.width = w2; c2.height = h2;
    const ctx2 = c2.getContext('2d');
    if (!ctx2) break;
    ctx2.imageSmoothingEnabled = true;
    ctx2.imageSmoothingQuality = 'high';
    ctx2.drawImage(canvas, 0, 0, w2, h2);
    // Re-encode at the best quality that still fits, walking the ladder down.
    let q2 = cfg.quality;
    let smaller = null;
    for (let i = 0; i < 6; i++) {
      smaller = await new Promise((r) => c2.toBlob(r, 'image/jpeg', q2));
      if (!smaller) break;
      if (smaller.size <= cfg.targetBytes || q2 <= cfg.minQuality) break;
      q2 = Math.max(cfg.minQuality, q2 - 0.08);
    }
    if (!smaller || smaller.size >= outBlob.size) break;
    outBlob = smaller;
    // Replace the working canvas so a second pass shrinks from the new size.
    canvas.width = w2; canvas.height = h2;
    const cx = canvas.getContext('2d');
    if (!cx) break;
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(c2, 0, 0);
    curW = w2; curH = h2;
  }

  // If compression somehow made it bigger, keep the original.
  if (outBlob.size >= file.size) return fail('compression-not-helpful');

  const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
  const compressed = new File([outBlob], name, { type: 'image/jpeg', lastModified: Date.now() });
  return {
    file: compressed,
    originalSize: file.size,
    size: compressed.size,
    ratio: compressed.size / file.size,
    skipped: null,
    // Report the FINAL size, which the extra shrink passes above may have
    // reduced — reporting the original w/h made a shrunk image look full-size.
    width: curW,
    height: curH
  };
}

// Compress a whole batch. `onProgress(done, total)` lets the caller show a
// meaningful "Compressing 3/10" message instead of a frozen button.
// Runs sequentially on purpose: parallel canvas encodes on a phone will jank the
// UI and can exhaust memory on a 10-photo batch.
async function compressImages(files, opts = {}, onProgress) {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    out.push(await compressImage(files[i], opts));
    if (typeof onProgress === 'function') onProgress(i + 1, files.length);
  }
  return out;
}

// Human-readable size, for the compression feedback message.
function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

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
  const perHead = `<div class="card-price-sub">per&nbsp;person / year</div>`;
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
