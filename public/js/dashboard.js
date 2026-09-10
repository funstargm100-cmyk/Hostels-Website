let currentUser = null;

async function initDashboard() {
  currentUser = await initNavAuth();
  if (!currentUser) { location.href = '/login?redirect=/dashboard'; return; }

  document.getElementById('sidebarName').textContent = currentUser.name;
  document.getElementById('sidebarRole').textContent = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);

  renderSidebarNav();

  const hash = location.hash.replace('#', '') || 'overview';
  const link = document.querySelector(`[href="#${hash}"]`);
  if (link) showTab(hash, link);
  else loadOverview();
}

// Build the desktop sidebar links (and mobile tab bar) from the user's role.
function renderSidebarNav() {
  const isOwner = currentUser.role === 'owner' || currentUser.role === 'agent';
  const items = [
    { tab: 'overview', icon: 'layout-dashboard', label: 'Overview' }
  ];
  if (isOwner) items.push({ tab: 'listings', icon: 'building-2', label: 'My listings' });
  else {
    items.push({ tab: 'requests', icon: 'message-circle', label: 'My requests' });
    items.push({ tab: 'favorites', icon: 'heart', label: 'Saved rooms' });
  }
  items.push({ tab: 'notifications', icon: 'bell', label: 'Notifications' });

  const nav = document.getElementById('sidebarNav');
  if (nav) {
    nav.innerHTML =
      `<a href="/" ><i data-lucide="home"></i> Home</a>` +
      items.map(it => `<a href="#${it.tab}" data-tab="${it.tab}"><i data-lucide="${it.icon}"></i> ${it.label}</a>`).join('');
    nav.querySelectorAll('a[data-tab]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); showTab(a.dataset.tab, a); }));
  }

  const mobile = document.getElementById('mobileTabs');
  if (mobile) {
    mobile.innerHTML = items.map(it =>
      `<a href="#${it.tab}" data-tab="${it.tab}">${it.label}</a>`).join('');
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
  if (link) link.classList.add('active');
  history.replaceState(null, '', `#${tab}`);
  const loaders = { overview: loadOverview, requests: loadRequests, listings: loadOwnerListings, favorites: loadFavorites, notifications: loadNotifications };
  loaders[tab]?.();
}

async function loadOverview() {
  const statsEl = document.getElementById('statCards');
  try {
    if (currentUser.role === 'owner' || currentUser.role === 'agent') {
      const { listings } = await api.get('/api/user/listings');
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-card-value">${listings.length}</div><div class="stat-card-label">My Listings</div></div>
        <div class="stat-card"><div class="stat-card-value">${listings.filter(l => l.status === 'active').length}</div><div class="stat-card-label">Active</div></div>
        <div class="stat-card"><div class="stat-card-value">${listings.reduce((s, l) => s + (l.views_count || 0), 0)}</div><div class="stat-card-label">Total Views</div></div>
        <div class="stat-card"><div class="stat-card-value">${listings.reduce((s, l) => s + (l.interest_count || 0), 0)}</div><div class="stat-card-label">Total Interests</div></div>`;
    } else {
      const { requests } = await api.get('/api/requests/mine');
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-card-value">${requests.length}</div><div class="stat-card-label">My Requests</div></div>
        <div class="stat-card"><div class="stat-card-value">${requests.filter(r => r.status === 'connected').length}</div><div class="stat-card-label">Connected</div></div>`;
    }
  } catch (e) { statsEl.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function loadRequests() {
  const el = document.getElementById('requestsList');
  try {
    const { requests } = await api.get('/api/requests/mine');
    if (!requests.length) { el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="message-circle" style="width:48px;height:48px"></i></div><p>No requests yet. <a href="/listings" style="color:var(--primary)">Browse rooms</a></p></div>'; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Listing</th><th>Status</th><th>Move-in</th><th>Date</th></tr></thead><tbody>` +
      requests.map(r => `<tr>
        <td><a href="/listing?id=${r.listing_uuid}" style="color:var(--primary)">${r.listing_title}</a><br><span class="text-muted">${r.location_area}</span></td>
        <td><span class="status-badge status-${r.status}">${r.status.replace('_', ' ')}</span></td>
        <td>${r.move_in_date ? new Date(r.move_in_date).toLocaleDateString() : '—'}</td>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
      </tr>`).join('') + '</tbody></table></div>';
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function loadOwnerListings() {
  const el = document.getElementById('ownerListings');
  try {
    const { listings } = await api.get('/api/user/listings');
    if (!listings.length) { el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="building-2" style="width:48px;height:48px"></i></div><p>No listings yet. <a href="/post-ad" style="color:var(--primary)">Post your first room</a></p></div>'; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Title</th><th>Status</th><th>Price</th><th>Views</th><th>Interest</th><th>Actions</th></tr></thead><tbody>` +
      listings.map(l => `<tr>
        <td><a href="/listing?id=${l.uuid}" style="color:var(--primary)">${l.title}</a></td>
        <td><span class="status-badge status-${l.status}">${l.status}</span></td>
        <td>GHS ${Number(l.price_per_head).toLocaleString()} / person</td>
        <td>${l.views_count}</td>
        <td>${l.interest_count}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="deactivateListing('${l.uuid}')">Deactivate</button></td>
      </tr>`).join('') + '</tbody></table></div>';
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function deactivateListing(uuid) {
  if (!confirm('Deactivate this listing?')) return;
  try {
    await api.delete(`/api/listings/${uuid}`);
    showToast('Listing deactivated', 'success');
    loadOwnerListings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadFavorites() {
  const el = document.getElementById('favoritesList');
  try {
    const { favorites } = await api.get('/api/user/favorites');
    if (!favorites.length) { el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon"><i data-lucide="heart" style="width:48px;height:48px"></i></div><p>No saved listings yet.</p></div>'; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.innerHTML = favorites.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function loadNotifications() {
  const el = document.getElementById('notificationsList');
  try {
    const { notifications } = await api.get('/api/user/notifications');
    if (!notifications.length) { el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="bell" style="width:48px;height:48px"></i></div><p>No notifications.</p></div>'; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.innerHTML = notifications.map(n => `
      <div style="padding:1rem;border-bottom:1px solid var(--border);${!n.is_read ? 'background:var(--primary-light)' : ''}">
        <div style="font-weight:600;font-size:0.875rem">${n.title}</div>
        <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.2rem">${n.message}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem">${new Date(n.created_at).toLocaleString()}</div>
      </div>`).join('');
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

initDashboard();
