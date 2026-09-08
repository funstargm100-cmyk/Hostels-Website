let pendingRejectId = null;
let pendingRequestId = null;
let pendingDeleteId = null;

async function initAdmin() {
  const user = await initNavAuth();
  if (!user || user.role !== 'admin') { location.href = '/login'; return; }
  loadAdminOverview();
}

function showAdminTab(tab, link) {
  document.querySelectorAll('[id^="admin-tab-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  const el = document.getElementById(`admin-tab-${tab}`);
  if (el) el.style.display = 'block';
  if (link) link.classList.add('active');
  const loaders = { overview: loadAdminOverview, listings: loadAdminListings, requests: loadAdminRequests, users: loadAdminUsers, reports: loadAdminReports, logs: loadAdminLogs };
  loaders[tab]?.();
}

async function loadAdminOverview() {
  try {
    const s = await api.get('/api/admin/dashboard');
    document.getElementById('adminStats').innerHTML = `
      <div class="stat-card"><div class="stat-card-value">${s.total_users}</div><div class="stat-card-label">Total Users</div></div>
      <div class="stat-card"><div class="stat-card-value">${s.active_listings}</div><div class="stat-card-label">Active Listings</div></div>
      <div class="stat-card"><div class="stat-card-value" style="color:#f59e0b">${s.pending_listings}</div><div class="stat-card-label">Pending Review</div></div>
      <div class="stat-card"><div class="stat-card-value" style="color:#3b82f6">${s.new_requests}</div><div class="stat-card-label">New Requests</div></div>
      <div class="stat-card"><div class="stat-card-value" style="color:#ef4444">${s.open_reports}</div><div class="stat-card-label">Open Reports</div></div>`;
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadAdminListings() {
  const status = document.getElementById('listingStatusFilter').value;
  const el = document.getElementById('adminListingsTable');
  try {
    const { listings } = await api.get(`/api/admin/listings?status=${status}`);
    if (!listings.length) { el.innerHTML = '<p class="text-muted">No listings.</p>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Title</th><th>Owner</th><th>Price</th><th>Date</th><th>Actions</th></tr></thead><tbody>` +
      listings.map(l => `<tr>
        <td><a href="/listing?id=${l.uuid}" target="_blank" style="color:var(--primary)">${l.title}</a></td>
        <td>${l.owner_name}<br><span class="text-muted" style="font-size:0.75rem">${l.owner_email}</span></td>
        <td>GHS ${Number(l.listed_price).toLocaleString()}</td>
        <td>${new Date(l.created_at).toLocaleDateString()}</td>
         <td style="display:flex;gap:0.4rem;flex-wrap:wrap">
           ${status === 'pending' ? `<button class="btn btn-secondary btn-sm" onclick="approveListing(${l.id})"><i data-lucide="check" style="width:14px;height:14px"></i> Approve</button><button class="btn btn-sm" style="background:#fee2e2;color:#991b1b" onclick="openRejectModal(${l.id})"><i data-lucide="x" style="width:14px;height:14px"></i> Reject</button>` : ''}
           ${status === 'active' ? `<button class="btn btn-ghost btn-sm" onclick="markUnavailable(${l.id})">Mark Unavailable</button><button class="btn btn-sm" style="background:#fee2e2;color:#991b1b" onclick="openDeleteModal(${l.id})"><i data-lucide="trash-2" style="width:14px;height:14px"></i> Delete</button>` : ''}
           ${status === 'deactivated' ? `<button class="btn btn-secondary btn-sm" onclick="reactivateListing(${l.id})"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i> Reactivate</button><button class="btn btn-sm" style="background:#fee2e2;color:#991b1b" onclick="openDeleteModal(${l.id})"><i data-lucide="trash-2" style="width:14px;height:14px"></i> Delete</button>` : ''}
         </td>
      </tr>`).join('') + '</tbody></table></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function approveListing(id) {
  try {
    await api.put(`/api/admin/listings/${id}/approve`);
    showToast('Listing approved', 'success');
    loadAdminListings();
  } catch (e) { showToast(e.message, 'error'); }
}

function openRejectModal(id) { pendingRejectId = id; openModal('rejectModal'); }

async function confirmReject() {
  const reason = document.getElementById('rejectReason').value;
  if (!reason) return showToast('Enter a reason', 'error');
  try {
    await api.put(`/api/admin/listings/${pendingRejectId}/reject`, { reason });
    closeModal('rejectModal');
    showToast('Listing rejected', 'success');
    loadAdminListings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function markUnavailable(id) {
  if (!confirm('Mark this listing as unavailable?')) return;
  try {
    await api.put(`/api/admin/listings/${id}/deactivate`);
    showToast('Listing marked as unavailable', 'success');
    loadAdminListings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function reactivateListing(id) {
  try {
    await api.put(`/api/admin/listings/${id}/reactivate`);
    showToast('Listing reactivated', 'success');
    loadAdminListings();
  } catch (e) { showToast(e.message, 'error'); }
}

function openDeleteModal(id) { pendingDeleteId = id; openModal('deleteModal'); }

async function confirmDelete() {
  try {
    await api.delete(`/api/admin/listings/${pendingDeleteId}`);
    closeModal('deleteModal');
    showToast('Listing deleted', 'success');
    loadAdminListings();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadAdminRequests() {
  const status = document.getElementById('requestStatusFilter').value;
  const el = document.getElementById('adminRequestsTable');
  try {
    const { requests } = await api.get(`/api/admin/requests${status ? '?status=' + status : ''}`);
    if (!requests.length) { el.innerHTML = '<p class="text-muted">No requests.</p>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Seeker</th><th>Listing</th><th>Owner Contact</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>` +
      requests.map(r => `<tr>
        <td>${r.seeker_name}<br><span class="text-muted" style="font-size:0.75rem">${r.seeker_phone || r.seeker_email || ''}</span></td>
        <td><a href="/listing?id=${r.listing_uuid}" target="_blank" style="color:var(--primary)">${r.listing_title}</a></td>
        <td style="font-size:0.82rem">${r.owner_name}<br>${r.owner_phone || r.owner_email || ''}</td>
        <td><span class="status-badge status-${r.status}">${r.status.replace('_', ' ')}</span></td>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
        <td><button class="btn btn-outline btn-sm" onclick="openRequestModal(${r.id},'${r.status}')">Update</button></td>
      </tr>`).join('') + '</tbody></table></div>';
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

function openRequestModal(id, currentStatus) {
  pendingRequestId = id;
  document.getElementById('newRequestStatus').value = currentStatus;
  document.getElementById('adminNotes').value = '';
  openModal('requestModal');
}

async function updateRequestStatus() {
  try {
    await api.put(`/api/admin/requests/${pendingRequestId}/status`, {
      status: document.getElementById('newRequestStatus').value,
      admin_notes: document.getElementById('adminNotes').value
    });
    closeModal('requestModal');
    showToast('Status updated', 'success');
    loadAdminRequests();
  } catch (e) { showToast(e.message, 'error'); }
}

async function loadAdminUsers() {
  const role = document.getElementById('userRoleFilter').value;
  const el = document.getElementById('adminUsersTable');
  try {
    const { users } = await api.get(`/api/admin/users${role ? '?role=' + role : ''}`);
    if (!users.length) { el.innerHTML = '<p class="text-muted">No users.</p>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Contact</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>` +
      users.map(u => `<tr>
        <td>${u.name}</td>
        <td style="font-size:0.82rem">${u.email || ''}<br>${u.phone || ''}</td>
        <td><span class="tag">${u.role}</span></td>
        <td>${u.is_suspended ? '<span class="badge" style="background:#fee2e2;color:#991b1b">Suspended</span>' : '<span class="badge badge-verified">Active</span>'}</td>
        <td>${u.is_suspended
          ? `<button class="btn btn-ghost btn-sm" onclick="unsuspendUser(${u.id})">Unsuspend</button>`
          : `<button class="btn btn-sm" style="background:#fee2e2;color:#991b1b" onclick="suspendUser(${u.id})">Suspend</button>`}
        </td>
      </tr>`).join('') + '</tbody></table></div>';
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function suspendUser(id) {
  if (!confirm('Suspend this user?')) return;
  try { await api.put(`/api/admin/users/${id}/suspend`); showToast('User suspended', 'success'); loadAdminUsers(); }
  catch (e) { showToast(e.message, 'error'); }
}
async function unsuspendUser(id) {
  try { await api.put(`/api/admin/users/${id}/unsuspend`); showToast('User unsuspended', 'success'); loadAdminUsers(); }
  catch (e) { showToast(e.message, 'error'); }
}

async function loadAdminReports() {
  const el = document.getElementById('adminReportsTable');
  try {
    const { reports } = await api.get('/api/admin/reports');
    if (!reports.length) { el.innerHTML = '<p class="text-muted">No open reports.</p>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Reporter</th><th>Listing</th><th>Reason</th><th>Date</th><th>Actions</th></tr></thead><tbody>` +
      reports.map(r => `<tr>
        <td>${r.reporter_name || 'Anonymous'}</td>
        <td>${r.listing_title ? `<a href="/listing?id=${r.listing_uuid}" target="_blank" style="color:var(--primary)">${r.listing_title}</a>` : '—'}</td>
        <td><span class="tag">${r.reason}</span></td>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="resolveReport(${r.id})">Resolve</button></td>
      </tr>`).join('') + '</tbody></table></div>';
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

async function resolveReport(id) {
  try { await api.put(`/api/admin/reports/${id}/resolve`); showToast('Report resolved', 'success'); loadAdminReports(); }
  catch (e) { showToast(e.message, 'error'); }
}

async function loadAdminLogs() {
  const el = document.getElementById('adminLogsTable');
  try {
    const { logs } = await api.get('/api/admin/logs');
    if (!logs.length) { el.innerHTML = '<p class="text-muted">No logs.</p>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Admin</th><th>Action</th><th>Target</th><th>Details</th><th>Date</th></tr></thead><tbody>` +
      logs.map(l => `<tr>
        <td>${l.admin_name}</td>
        <td><span class="tag">${l.action}</span></td>
        <td>${l.target_type} #${l.target_id}</td>
        <td style="font-size:0.82rem;color:var(--text-muted)">${l.details || '—'}</td>
        <td>${new Date(l.created_at).toLocaleString()}</td>
      </tr>`).join('') + '</tbody></table></div>';
  } catch (e) { el.innerHTML = `<p class="text-muted">${e.message}</p>`; }
}

initAdmin();
