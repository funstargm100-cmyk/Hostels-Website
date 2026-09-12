let currentUser = null;
let profileData = null;
const ROLE_LABEL = { seeker: 'Seeker', owner: 'Owner', agent: 'Agent', admin: 'Admin' };
const isOwnerRole = (role) => role === 'owner' || role === 'agent';

async function initDashboard() {
  currentUser = await initNavAuth();
  if (!currentUser) { location.href = '/login?redirect=/dashboard'; return; }

  const role = ROLE_LABEL[currentUser.role] || currentUser.role;
  document.getElementById('sidebarName').textContent = currentUser.name;
  document.getElementById('sidebarRole').textContent = role;
  const mName = document.getElementById('mobileName'); if (mName) mName.textContent = currentUser.name;
  const mRole = document.getElementById('mobileRole'); if (mRole) mRole.textContent = role;
  const initial = (currentUser.name || 'R').trim().charAt(0).toUpperCase();
  ['sidebarAvatar', 'mobileAvatar'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = initial; });

  // Point the top-bar logo at the user's role-specific home page.
  // (initNavAuth already applied this to every a.logo; kept here so the intent
  // is explicit and the dashboard works even if that call changes.)
  if (window.applyRoleToLogo) window.applyRoleToLogo(currentUser.role);

  // Greeting header removed — the sidebar is now the single navigation surface.
  renderSidebarNav();
  initDashboardSidebar();
  if (window.renderFooterNav) window.renderFooterNav();

  const hash = location.hash.replace('#', '') || 'overview';
  showTab(hash);
}

// ─── SIDEBAR (static on desktop, off-canvas drawer on mobile) ──────
const isMobileSidebar = () => window.matchMedia('(max-width:900px)').matches;

function toggleMobileSidebar(force) {
  const shell = document.getElementById('dashboardShell');
  const btn = document.getElementById('sidebarMobileToggle');
  if (!shell) return;
  const open = typeof force === 'boolean' ? force : !shell.classList.contains('mobile-sidebar-open');
  shell.classList.toggle('mobile-sidebar-open', open);
  document.body.style.overflow = open && isMobileSidebar() ? 'hidden' : '';
  if (btn) {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
}

function initDashboardSidebar() {
  const shell = document.getElementById('dashboardShell');
  const btn = document.getElementById('sidebarMobileToggle');
  if (btn) btn.addEventListener('click', () => toggleMobileSidebar());

  const backdrop = document.getElementById('sidebarBackdrop');
  if (backdrop) backdrop.addEventListener('click', () => toggleMobileSidebar(false));

  // Click anywhere outside the panel (e.g. on the page content) closes the drawer.
  closeSidebarOnOutsideClick({
    sidebarId: 'dashboardSidebar',
    isOpen: () => !!shell && shell.classList.contains('mobile-sidebar-open'),
    onOutside: () => toggleMobileSidebar(false)
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleMobileSidebar(false); });

  // Leaving mobile width: drop the drawer state and unlock scrolling.
  window.addEventListener('resize', () => {
    if (!isMobileSidebar()) toggleMobileSidebar(false);
  });

  const logout = document.getElementById('sidebarLogout');
  if (logout) logout.addEventListener('click', confirmLogout);
}

function confirmLogout() {
  if (!confirm('Log out of Roomy?\n\nYou\'ll need to sign in again to see your dashboard.')) return;
  handleLogout();
}

// Build the desktop sidebar links (and mobile tab bar) from the user's role.
function renderSidebarNav() {
  const isOwner = currentUser.role === 'owner' || currentUser.role === 'agent';
  const items = [
    { tab: 'overview', icon: 'layout-dashboard', label: 'Overview' }
  ];
  if (isOwner) items.push({ tab: 'listings', icon: 'building-2', label: 'My rooms' });
  else {
    items.push({ tab: 'requests', icon: 'message-circle', label: 'My requests' });
    items.push({ tab: 'favorites', icon: 'heart', label: 'Saved rooms' });
  }
  items.push({ tab: 'notifications', icon: 'bell', label: 'Notifications' });
  items.push({ tab: 'account', icon: 'user', label: 'Account' });

  const home = (window.goHomeForRole ? window.goHomeForRole(currentUser.role) : '/');
  const nav = document.getElementById('sidebarNav');
  if (nav) {
    nav.innerHTML =
      `<a href="${home}"><i data-lucide="home"></i> Home</a>` +
      items.map(it => `<a href="#${it.tab}" data-tab="${it.tab}"><i data-lucide="${it.icon}"></i> ${it.label}</a>`).join('');
    nav.querySelectorAll('a[data-tab]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); showTab(a.dataset.tab, a); }));
  }

  const mobile = document.getElementById('mobileTabs');
  if (mobile) {
    mobile.innerHTML = items.map(it =>
      `<a href="#${it.tab}" data-tab="${it.tab}"><i data-lucide="${it.icon}"></i> ${it.label}</a>`).join('');
    mobile.querySelectorAll('a[data-tab]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); showTab(a.dataset.tab, document.querySelector(`#sidebarNav [data-tab="${a.dataset.tab}"]`)); }));
  }

  // Highlight the active tab once links exist
  const active = document.querySelector(`#sidebarNav [data-tab="${location.hash.replace('#','') || 'overview'}"]`);
  if (active) active.classList.add('active');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showTab(tab, link) {
  document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  const el = document.getElementById(`tab-${tab}`);
  if (el) el.style.display = 'block';
  link = link || document.querySelector(`#sidebarNav [data-tab="${tab}"]`);
  if (link) link.classList.add('active');
  history.replaceState(null, '', `#${tab}`);
  const loaders = { overview: loadOverview, requests: loadRequests, listings: loadOwnerListings, favorites: loadFavorites, notifications: loadNotifications, account: loadAccount };
  loaders[tab]?.();
  // On mobile, close the drawer after choosing a tab.
  if (isMobileSidebar()) toggleMobileSidebar(false);
}
window.showTab = showTab;
window.dashboardShowTab = (tab) => showTab(tab);

async function loadOverview() {
  const statsEl = document.getElementById('statCards');
  try {
    if (isOwnerRole(currentUser.role)) {
      const { listings } = await api.get('/api/user/listings');
      const views = listings.reduce((s, l) => s + (l.views_count || 0), 0);
      const interest = listings.reduce((s, l) => s + (l.interest_count || 0), 0);
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-card-value">${listings.length}</div><div class="stat-card-label">My rooms</div></div>
        <div class="stat-card"><div class="stat-card-value">${listings.filter(l => l.status === 'active').length}</div><div class="stat-card-label">Active</div></div>
        <div class="stat-card"><div class="stat-card-value">${views}</div><div class="stat-card-label">Views</div></div>
        <div class="stat-card"><div class="stat-card-value">${interest}</div><div class="stat-card-label">Interest</div></div>`;
    } else {
      const [{ requests }, { favorites }, { user }] = await Promise.all([
        api.get('/api/requests/mine'),
        api.get('/api/user/favorites'),
        api.get('/api/user/profile')
      ]);
      profileData = user;
      const days = Math.max(0, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000));
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-card-value">${requests.length}</div><div class="stat-card-label">My requests</div></div>
        <div class="stat-card"><div class="stat-card-value">${requests.filter(r => r.status === 'connected').length}</div><div class="stat-card-label">Connected</div></div>
        <div class="stat-card"><div class="stat-card-value">${favorites.length}</div><div class="stat-card-label">Saved rooms</div></div>
        <div class="stat-card"><div class="stat-card-value">${days}</div><div class="stat-card-label">Days on Roomy</div></div>`;
    }
  } catch (e) { statsEl.innerHTML = `<p class="text-muted">${e.message}</p>`; }
  loadActivity();
}

async function loadRequests() {
  const el = document.getElementById('requestsList');
  renderStatusLegend();
  try {
    const { requests } = await api.get('/api/requests/mine');
    if (!requests.length) { el.innerHTML = `<div class="empty-state"><div class="icon"><i data-lucide="message-circle" style="width:48px;height:48px"></i></div><p>You haven't reached out to any rooms yet — browse rooms and tap “I'm Interested” to start.</p><a href="/listings" class="btn btn-primary btn-sm" style="margin-top:.9rem">Browse rooms</a></div>`; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Room</th><th>Status</th><th>Move-in</th><th>Date</th></tr></thead><tbody>` +
      requests.map(r => `<tr>
        <td><a href="/listing?id=${r.listing_uuid}" style="color:var(--primary)">${r.listing_title}</a><br><span class="text-muted">${r.location_area}</span></td>
        <td><span class="status-badge status-${r.status}">${r.status.replace('_', ' ')}</span></td>
        <td>${r.move_in_date ? new Date(r.move_in_date).toLocaleDateString() : '—'}</td>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
      </tr>`).join('') + '</tbody></table></div>';
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

// One-line colour key for the request status column.
function renderStatusLegend() {
  const el = document.getElementById('requestsLegend');
  if (!el) return;
  const items = [['received', 'Received'], ['in_progress', 'In progress'], ['connected', 'Connected'], ['closed', 'Closed']];
  el.innerHTML = '<span class="legend-title">Status key</span>' +
    items.map(([s, label]) => `<span class="legend-item"><span class="legend-dot status-${s}"></span>${label}</span>`).join('');
}

async function loadOwnerListings() {
  const el = document.getElementById('ownerListings');
  try {
    const { listings } = await api.get('/api/user/listings');
    if (!listings.length) { el.innerHTML = `<div class="empty-state"><div class="icon"><i data-lucide="building-2" style="width:48px;height:48px"></i></div><p>You don't have any rooms yet. Post your first room — it's free.</p><a href="/post-ad" class="btn btn-primary btn-sm" style="margin-top:.9rem">Post a room</a></div>`; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    // Performance nudge: rooms with no views get more traction with more photos.
    const tip = listings.some(l => (l.views_count || 0) === 0)
      ? `<div class="tip-box"><i data-lucide="lightbulb"></i><span>Add more photos to get up to 3× more interest — rooms with a full gallery get noticed faster.</span></div>`
      : '';
    el.innerHTML = tip + `<div class="table-wrap"><table><thead><tr><th>Title</th><th>Status</th><th>Price</th><th>Views</th><th>Interest</th><th>Actions</th></tr></thead><tbody>` +
      listings.map(l => `<tr>
        <td><a href="/listing?id=${l.uuid}" style="color:var(--primary)">${l.title}</a></td>
        <td><span class="status-badge status-${l.status}">${l.status}</span></td>
        <td>GHS ${Number(l.price_per_head).toLocaleString()} / person</td>
        <td>${l.views_count}</td>
        <td>${l.interest_count}</td>
        <td style="white-space:nowrap">
          <a href="/edit-listing?id=${l.uuid}" class="btn btn-outline btn-sm"><i data-lucide="pencil"></i> Edit</a>
          ${l.status === 'active' ? `<button class="btn btn-ghost btn-sm" onclick="deactivateListing('${l.uuid}')">Deactivate</button>` : ''}
        </td>
      </tr>`).join('') + '</tbody></table></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function deactivateListing(uuid) {
  if (!confirm('Deactivate this room?')) return;
  try {
    await api.delete(`/api/listings/${uuid}`);
    showToast('Room deactivated', 'success');
    loadOwnerListings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadFavorites() {
  const el = document.getElementById('favoritesList');
  try {
    const { favorites } = await api.get('/api/user/favorites');
    if (!favorites.length) { el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon"><i data-lucide="heart" style="width:48px;height:48px"></i></div><p>Nothing saved yet. Tap the ♥ on any room to shortlist it here.</p></div>'; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.innerHTML = favorites.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function loadNotifications() {
  const el = document.getElementById('notificationsList');
  try {
    const { notifications } = await api.get('/api/user/notifications');
    if (!notifications.length) { el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="check-circle" style="width:48px;height:48px"></i></div><p>You\'re all caught up.</p></div>'; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.innerHTML = notifications.map(n => `
      <div style="padding:1rem;border-bottom:1px solid var(--border);${!n.is_read ? 'background:var(--primary-light)' : ''}">
        <div style="font-weight:600;font-size:0.875rem">${n.title}</div>
        <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.2rem">${n.message}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem">${new Date(n.created_at).toLocaleString()}</div>
      </div>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

// ─── RECENT ACTIVITY ──────────────────────────
// Merged feed of the most recent events (server: GET /api/user/activity).
async function loadActivity() {
  const el = document.getElementById('recentActivity');
  if (!el) return;
  try {
    const { events } = await api.get('/api/user/activity');
    if (!events.length) {
      el.innerHTML = `<div class="empty-state" style="padding:1.6rem 1rem"><div class="icon"><i data-lucide="sparkles" style="width:40px;height:40px"></i></div><p>Nothing here yet — once you browse or list a room, your activity shows up here.</p></div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }
    el.innerHTML = events.map(renderEvent).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

function renderEvent(ev) {
  const title = ev.title || 'your room';
  const owner = isOwnerRole(currentUser.role);
  let icon = 'activity', text = title, linked = false;
  switch (ev.type) {
    case 'interest':
      linked = true;
      if (owner) { icon = 'message-circle'; text = `Someone showed interest in “${title}”`; }
      else { icon = 'send'; text = `You expressed interest in “${title}”`; }
      break;
    case 'saved':
      linked = true; icon = 'heart'; text = `You saved “${title}”`; break;
    case 'posted':
      linked = true; icon = 'plus-circle'; text = `“${title}” was posted`; break;
    case 'status':
      linked = true;
      if (ev.status === 'active') { icon = 'check-circle'; text = `“${title}” was approved and is live`; }
      else if (ev.status === 'rejected') { icon = 'x-circle'; text = `“${title}” was rejected`; }
      else if (ev.status === 'connected') { icon = 'check-circle'; text = 'Your request was marked Connected'; }
      else { icon = 'info'; text = `“${title}” was marked ${cap(ev.status)}`; }
      break;
    case 'views':
      linked = true; icon = 'eye'; text = `“${title}” has been viewed ${ev.count} times`; break;
  }
  const href = linked && ev.listing_uuid ? `/listing?id=${ev.listing_uuid}` : null;
  const body = href ? `<a href="${href}">${text}</a>` : text;
  return `<div class="activity-item">
      <span class="activity-icon"><i data-lucide="${icon}"></i></span>
      <div class="activity-body">
        <div class="activity-text">${body}</div>
        <div class="activity-time">${relativeTime(ev.ts)}</div>
      </div>
    </div>`;
}

function cap(s) {
  return String(s || '').split('_').join(String.fromCharCode(32)).replace(/^./, (c) => c.toUpperCase());
}

function relativeTime(ts) {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── ACCOUNT ──────────────────
const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function loadAccount() {
  const el = document.getElementById('accountPanel');
  if (!el) return;
  el.innerHTML = '<p class="text-muted">Loading…</p>';
  try {
    const { user } = await api.get('/api/user/profile');
    profileData = user;
    const memberSince = new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    // The seeker's daily base is FIXED to UENR — shown read-only, never editable.
    // Owners have no base_location at all.
    const showLocation = !isOwnerRole(user.role);
    el.innerHTML = `
      <div class="account-grid">
        <div class="card account-card">
          <h3>Profile details</h3>
          <form id="accountForm">
            <div class="form-group"><label for="acctName">Full name</label><input id="acctName" value="${escAttr(user.name)}" required /></div>
            <div class="form-group"><label for="acctEmail">Email</label><input id="acctEmail" type="email" value="${escAttr(user.email || '')}" required /></div>
            <div class="form-group"><label for="acctPhone">Phone</label><input id="acctPhone" type="tel" value="${escAttr(user.phone || '')}" /></div>
            ${showLocation ? `<div class="form-group"><label>Base location (fixed)</label><input value="${escAttr(user.base_location || 'UENR, Sunyani')}" disabled /><span class="field-hint">Every seeker's daily base is set to UENR and cannot be changed.</span></div>` : ''}
            <button class="btn btn-primary" type="submit">Save changes</button>
          </form>
        </div>
        <div class="card account-card">
          <h3>Change password</h3>
          <form id="passwordForm">
            <div class="form-group"><label for="curPw">Current password</label><input id="curPw" type="password" autocomplete="current-password" required /></div>
            <div class="form-group"><label for="newPw">New password</label><input id="newPw" type="password" autocomplete="new-password" minlength="6" required /></div>
            <div class="form-group"><label for="confPw">Confirm new password</label><input id="confPw" type="password" autocomplete="new-password" minlength="6" required /></div>
            <button class="btn btn-outline" type="submit">Update password</button>
          </form>
        </div>
        <div class="card account-card">
          <h3>Account</h3>
          <div class="account-meta">
            <div><span class="text-muted">Role</span><strong>${ROLE_LABEL[user.role] || user.role}</strong></div>
            <div><span class="text-muted">Member since</span><strong>${memberSince}</strong></div>
            ${showLocation ? `<div><span class="text-muted">Location</span><strong>${escAttr(user.base_location || 'Not set')}</strong></div>` : ''}
            <div><span class="text-muted">Email verified</span><strong>${user.is_verified ? 'Yes' : 'No'}</strong></div>
            <div><span class="text-muted">ID verified</span><strong>${user.is_kyc_verified ? 'Yes' : 'No'}</strong></div>
          </div>
        </div>
      </div>`;
    document.getElementById('accountForm').addEventListener('submit', onAccountSave);
    document.getElementById('passwordForm').addEventListener('submit', onPasswordSave);
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

// Keep the sidebar / greeting in sync after a name change.
function applyAccountName(name) {
  currentUser.name = name;
  try {
    const stored = JSON.parse(localStorage.getItem('user') || '{}');
    localStorage.setItem('user', JSON.stringify({ ...stored, name }));
  } catch {}
  const sidebar = document.getElementById('sidebarName'); if (sidebar) sidebar.textContent = name;
  const mobile = document.getElementById('mobileName'); if (mobile) mobile.textContent = name;
  const initial = (name || 'R').trim().charAt(0).toUpperCase();
  ['sidebarAvatar', 'mobileAvatar'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = initial; });
}

async function onAccountSave(ev) {
  ev.preventDefault();
  const btn = ev.target.querySelector('button[type="submit"]');
  const payload = {
    name: document.getElementById('acctName').value.trim(),
    email: document.getElementById('acctEmail').value.trim(),
    phone: document.getElementById('acctPhone').value.trim()
    // No base_location here: the seeker's daily base is locked to UENR and the
    // server ignores any base fields the client sends.
  };
  btn.disabled = true;
  try {
    const { user } = await api.put('/api/user/profile', payload);
    applyAccountName(user.name);
    showToast('Profile updated', 'success');
  } catch (e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function onPasswordSave(ev) {
  ev.preventDefault();
  const cur = document.getElementById('curPw').value;
  const nw = document.getElementById('newPw').value;
  const conf = document.getElementById('confPw').value;
  if (nw !== conf) return showToast('New passwords do not match', 'error');
  if (nw.length < 6) return showToast('New password must be at least 6 characters', 'error');
  const btn = ev.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api.put('/api/user/password', { current_password: cur, new_password: nw });
    ev.target.reset();
    showToast('Password changed', 'success');
  } catch (e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

initDashboard();
