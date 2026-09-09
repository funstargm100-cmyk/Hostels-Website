// Tailored dashboard: owners/agents get listing management; seekers get
// requests + favorites. Mobile gets bottom tabs instead of the sidebar.
let currentUser = null;
let isOwner = false;

const OWNER_TABS = [
  { id: 'overview', icon: 'layout-dashboard', label: 'Overview' },
  { id: 'listings', icon: 'building-2', label: 'My Listings' },
  { id: 'notifications', icon: 'bell', label: 'Notifications' }
];
const SEEKER_TABS = [
  { id: 'overview', icon: 'layout-dashboard', label: 'Overview' },
  { id: 'requests', icon: 'message-circle', label: 'Requests' },
  { id: 'favorites', icon: 'heart', label: 'Saved' },
  { id: 'notifications', icon: 'bell', label: 'Alerts' }
];

async function initDashboard() {
  currentUser = await initNavAuth();
  if (!currentUser) { location.href = '/login?redirect=/dashboard'; return; }

  isOwner = currentUser.role === 'owner' || currentUser.role === 'agent' || currentUser.role === 'admin';
  const firstName = currentUser.name.split(' ')[0];

  document.getElementById('sidebarName').textContent = currentUser.name;
  document.getElementById('sidebarRole').textContent = isOwner ? 'Host / Agent' : 'Room Seeker';
  document.getElementById('mobileName').textContent = `Hi, ${firstName}`;
  document.getElementById('mobileRole').textContent = isOwner ? 'Host / Agent' : 'Room Seeker';
  document.querySelector('.dashboard-topbar').style.display = 'flex';

  const tabs = isOwner ? OWNER_TABS : SEEKER_TABS;
  document.getElementById('sidebarNav').innerHTML = tabs.map(t =>
    `<li><a href="#${t.id}" data-tab="${t.id}" onclick="dashboardShowTab('${t.id}',this)"><i data-lucide="${t.icon}"></i> ${t.label}</a></li>`).join('');
  document.getElementById('mobileTabs').innerHTML = tabs.map(t =>
    `<button data-tab="${t.id}" onclick="dashboardShowTab('${t.id}',this)"><i data-lucide="${t.icon}"></i>${t.label}</button>`).join('');

  if (isOwner) {
    document.getElementById('ownerBanner').style.display = 'flex';
    document.getElementById('ownerGreeting').textContent = firstName;
  } else {
    document.getElementById('seekerActions').style.display = 'grid';
  }

  const hash = location.hash.replace('#', '');
  const valid = tabs.some(t => t.id === hash) ? hash : 'overview';
  dashboardShowTab(valid);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function dashboardShowTab(tab, link) {
  document.querySelectorAll('[id^="tab-"]').forEach(el => { el.style.display = 'none'; el.classList.remove('tab-panel'); });
  const el = document.getElementById(`tab-${tab}`);
  if (el) { el.style.display = 'block'; void el.offsetWidth; el.classList.add('tab-panel'); }
  document.querySelectorAll('.sidebar-nav a, .mobile-tabs button').forEach(a =>
    a.classList.toggle('active', a.dataset.tab === tab));
  history.replaceState(null, '', `#${tab}`);
  const loaders = { overview: loadOverview, requests: loadRequests, listings: loadOwnerListings, favorites: loadFavorites, notifications: loadNotifications };
  loaders[tab]?.();
}

async function loadOverview() {
  const statsEl = document.getElementById('statCards');
  document.getElementById('overviewTitle').textContent = isOwner ? 'Business Overview' : 'Your Overview';
  statsEl.innerHTML = '<div class="spinner-center"><span class="spinner spinner-lg"></span>Loading stats...</div>';
  try {
    if (isOwner) {
      const { listings } = await api.get('/api/user/listings');
      const active = listings.filter(l => l.status === 'active').length;
      const pending = listings.filter(l => l.status === 'pending').length;
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-card-value">${listings.length}</div><div class="stat-card-label">Total Listings</div></div>
        <div class="stat-card"><div class="stat-card-value">${active}</div><div class="stat-card-label">Available Now</div></div>
        <div class="stat-card"><div class="stat-card-value">${pending}</div><div class="stat-card-label">Pending Review</div></div>
        <div class="stat-card"><div class="stat-card-value">${listings.reduce((s, l) => s + (l.views_count || 0), 0)}</div><div class="stat-card-label">Total Views</div></div>
        <div class="stat-card"><div class="stat-card-value">${listings.reduce((s, l) => s + (l.interest_count || 0), 0)}</div><div class="stat-card-label">Total Interests</div></div>`;
      const recent = listings.slice(0, 4);
      document.getElementById('recentActivity').innerHTML = recent.length
        ? recent.map(l => `<div style="display:flex;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid var(--border);font-size:0.875rem">
            <span>${l.title}</span><span class="status-badge status-${l.status}">${l.status}</span></div>`).join('')
        : '<p class="text-muted" style="font-size:0.875rem">No listings yet — post your first room!</p>';
    } else {
      const { requests } = await api.get('/api/requests/mine');
      statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-card-value">${requests.length}</div><div class="stat-card-label">Requests Sent</div></div>
        <div class="stat-card"><div class="stat-card-value">${requests.filter(r => r.status === 'connected').length}</div><div class="stat-card-label">Connected</div></div>
        <div class="stat-card"><div class="stat-card-value">${requests.filter(r => r.status === 'in_progress').length}</div><div class="stat-card-label">In Progress</div></div>`;
      const recent = requests.slice(0, 4);
      document.getElementById('recentActivity').innerHTML = recent.length
        ? recent.map(r => `<div style="display:flex;justify-content:space-between;padding:0.6rem 0;border-bottom:1px solid var(--border);font-size:0.875rem">
            <span>${r.listing_title}</span><span class="status-badge status-${r.status}">${r.status.replace('_',' ')}</span></div>`).join('')
        : '<p class="text-muted" style="font-size:0.875rem">No requests yet — <a href="/listings" style="color:var(--primary)">browse rooms</a> to get started.</p>';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { statsEl.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function loadRequests() {
  const el = document.getElementById('requestsList');
  el.innerHTML = '<div class="spinner-center"><span class="spinner spinner-lg"></span>Loading requests...</div>';
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
  el.innerHTML = '<div class="spinner-center"><span class="spinner spinner-lg"></span>Loading your listings...</div>';
  try {
    const { listings } = await api.get('/api/user/listings');
    if (!listings.length) { el.innerHTML = '<div class="empty-state"><div class="icon"><i data-lucide="building-2" style="width:48px;height:48px"></i></div><p>No listings yet. <a href="/post-ad" style="color:var(--primary)">Post your first room</a></p></div>'; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.gap = '0.75rem';
    el.innerHTML = listings.map(l => `
      <div class="owner-listing-card">
        <img src="${l.primary_image || '/images/placeholder.jpg'}" alt="${l.title}" loading="lazy" onerror="this.src='/images/placeholder.jpg'" />
        <div class="owner-listing-body">
          <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:flex-start">
            <a href="/listing?id=${l.uuid}" class="owner-listing-title">${l.title}</a>
            <span class="status-badge status-${l.status} ${l.status === 'pending' ? 'pulse' : ''}">${l.status}</span>
          </div>
          <div class="owner-listing-meta">
            <span><i data-lucide="banknote" style="width:13px;height:13px"></i> GHS ${Number(l.listed_price).toLocaleString()}</span>
            <span><i data-lucide="eye" style="width:13px;height:13px"></i> ${l.views_count} views</span>
            <span><i data-lucide="users" style="width:13px;height:13px"></i> ${l.interest_count} interested</span>
            <span><i data-lucide="map-pin" style="width:13px;height:13px"></i> ${l.location_area}</span>
          </div>
          <div class="owner-listing-actions">
            <a href="/edit-listing?id=${l.uuid}" class="btn btn-outline btn-sm"><i data-lucide="pencil" style="width:13px;height:13px"></i> Edit</a>
            ${l.status === 'active' || l.status === 'pending'
              ? `<button class="btn btn-ghost btn-sm" onclick="setAvailability('${l.uuid}',false,this)" ${l.status === 'pending' ? 'disabled title="Pending admin review"' : ''}><i data-lucide="eye-off" style="width:13px;height:13px"></i> Mark Unavailable</button>`
              : `<button class="btn btn-primary btn-sm" onclick="setAvailability('${l.uuid}',true,this)"><i data-lucide="eye" style="width:13px;height:13px"></i> Mark Available</button>`}
            <button class="btn btn-ghost btn-sm" style="color:#991b1b" onclick="deactivateListing('${l.uuid}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i> Remove</button>
          </div>
        </div>
      </div>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function setAvailability(uuid, available, btn) {
  const original = btn.innerHTML;
  btn.disabled = true; btn.classList.add('btn-loading');
  try {
    const { message } = await api.put(`/api/listings/${uuid}/availability`, { available });
    showToast(message, 'success');
    const card = btn.closest('.owner-listing-card');
    if (card) { card.style.transition = 'opacity 0.2s'; card.style.opacity = '0.4'; }
    setTimeout(() => loadOwnerListings(), 250);
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false; btn.classList.remove('btn-loading'); btn.innerHTML = original;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
  }
}

async function deactivateListing(uuid) {
  if (!confirm('Remove this listing permanently from the marketplace?')) return;
  try {
    await api.delete(`/api/listings/${uuid}`);
    showToast('Listing removed', 'success');
    loadOwnerListings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadFavorites() {
  const el = document.getElementById('favoritesList');
  el.innerHTML = '<div class="spinner-center"><span class="spinner spinner-lg"></span>Loading saved rooms...</div>';
  try {
    const { favorites } = await api.get('/api/user/favorites');
    if (!favorites.length) { el.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon"><i data-lucide="heart" style="width:48px;height:48px"></i></div><p>No saved listings yet. <a href="/listings" style="color:var(--primary)">Find your room</a></p></div>'; if (typeof lucide !== 'undefined') lucide.createIcons(); return; }
    el.innerHTML = favorites.map(renderListingCard).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function loadNotifications() {
  const el = document.getElementById('notificationsList');
  el.innerHTML = '<div class="spinner-center"><span class="spinner spinner-lg"></span>Loading notifications...</div>';
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
