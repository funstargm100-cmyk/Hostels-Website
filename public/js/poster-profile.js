// Public ad-poster profile: browse all their active listings + follow them.
const posterId = new URLSearchParams(location.search).get('id');
let posterData = null;

async function loadPoster() {
  if (!posterId) { location.href = '/listings'; return; }
  try {
    const data = await api.get(`/api/users/${posterId}`);
    posterData = data;
    document.getElementById('profileSkeleton').style.display = 'none';
    document.getElementById('profileContent').style.display = 'block';
    document.title = `${data.poster.name} — Roomy`;

    document.getElementById('posterName').textContent = data.poster.name;
    document.getElementById('posterAvatar').textContent = (data.poster.name || 'O').charAt(0).toUpperCase();
    if (data.poster.avatar) document.getElementById('posterAvatar').style.backgroundImage = `url(${data.poster.avatar})`;

    const meta = [];
    if (data.poster.is_kyc_verified) meta.push('<span class="badge badge-verified"><i data-lucide="badge-check" style="width:11px;height:11px"></i> Verified</span>');
    meta.push(`<i data-lucide="building-2" style="width:12px;height:12px"></i> ${data.poster.role === 'agent' ? 'Agent' : 'Landlord / Owner'}`);
    meta.push(`${data.poster.listing_count} room${data.poster.listing_count === 1 ? '' : 's'} listed`);
    document.getElementById('posterMeta').innerHTML = meta.join(' ');

    document.getElementById('memberSince').innerHTML = `<i data-lucide="calendar" style="width:12px;height:12px"></i> Member since ${new Date(data.poster.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
    document.getElementById('followerCount').textContent = `${data.followers} follower${data.followers === 1 ? '' : 's'}`;

    renderFollowBtn(data.following);
    renderListings(data.listings);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    document.getElementById('profileSkeleton').innerHTML = `<div class="alert alert-danger">Failed to load profile: ${e.message}</div>`;
  }
}

function renderListings(listings) {
  const el = document.getElementById('posterListings');
  if (!listings.length) {
    el.innerHTML = '<div class="empty-state"><p>This ad poster has no active rooms right now.</p></div>';
    return;
  }
  el.innerHTML = listings.map(l => renderListingCard(l)).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
}

function renderFollowBtn(following) {
  const btn = document.getElementById('followBtn');
  btn.innerHTML = following
    ? '<i data-lucide="user-check"></i> <span id="followBtnLabel">Following</span>'
    : '<i data-lucide="user-plus"></i> <span id="followBtnLabel">Follow</span>';
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

async function toggleFollow() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) return location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
  const btn = document.getElementById('followBtn');
  btn.disabled = true;
  try {
    const { following } = await api.post(`/api/users/${posterId}/follow`);
    posterData.following = following;
    posterData.followers += following ? 1 : -1;
    renderFollowBtn(following);
    document.getElementById('followerCount').textContent = `${posterData.followers} follower${posterData.followers === 1 ? '' : 's'}`;
    showToast(following ? `Following ${posterData.poster.name} — you'll be notified about new rooms.` : 'Unfollowed.', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

loadPoster();
