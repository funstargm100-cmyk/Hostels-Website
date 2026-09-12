const listingUUID = new URLSearchParams(location.search).get('id');
let currentListing = null;

const AMENITY_MAP = {
  water: {
    constant: { icon: 'droplets', label: 'Constant Water' },
    intermittent: { icon: 'droplets', label: 'Intermittent Water' },
    borehole: { icon: 'droplets', label: 'Borehole' },
    none: { icon: 'droplets', label: 'No Water' }
  },
  electricity: {
    prepaid: { icon: 'zap', label: 'Prepaid Meter' },
    postpaid: { icon: 'zap', label: 'Postpaid' },
    generator: { icon: 'zap', label: 'Generator Backup' },
    none: { icon: 'zap', label: 'No Electricity' }
  },
  security: {
    fenced: { icon: 'shield', label: 'Fenced' },
    gated: { icon: 'shield', label: 'Gated' },
    guard: { icon: 'shield', label: 'Security Guard' },
    cctv: { icon: 'shield', label: 'CCTV' },
    none: { icon: 'shield', label: 'No Security' }
  },
  furnishing: {
    furnished: { icon: 'armchair', label: 'Furnished' },
    'semi-furnished': { icon: 'armchair', label: 'Semi-Furnished' },
    unfurnished: { icon: 'armchair', label: 'Unfurnished' }
  },
  bathroom: {
    private: { icon: 'shower-head', label: 'Private Bathroom' },
    shared: { icon: 'shower-head', label: 'Shared Bathroom' }
  }
};

async function loadListing() {
  if (!listingUUID) { location.href = '/listings'; return; }
  try {
    const { listing, images, amenities, reviews } = await api.get(`/api/listings/${listingUUID}`);
    currentListing = listing;
    document.title = `${listing.title} — Roomy`;
    document.getElementById('detailSkeleton').style.display = 'none';
    document.getElementById('detailContent').style.display = 'block';

    renderGallery(images);
    renderBadges(listing);
    document.getElementById('listingTitle').textContent = listing.title;
    document.getElementById('listingLocation').innerHTML = `<i data-lucide="map-pin" style="width:13px;height:13px"></i> ${listing.location_area}${listing.nearest_landmark ? ' · ' + listing.nearest_landmark : ''}`;
    document.getElementById('listingDescription').textContent = listing.description || 'No description provided.';
    renderAmenities(amenities);
    renderPriceBox(listing);
    renderReviews(reviews, listing.avg_rating, listing.review_count);
    initMap(listing.display_lat, listing.display_lng, listing.location_area);
    // Owners get management actions instead of Request / Favorite. Re-check after
    // initNavAuth refreshes the cached user, so the correct actions always show.
    if (isOwnListing(listing)) setUpOwnerView(listing);
    initNavAuth().then(() => {
      if (isOwnListing(currentListing)) {
        setUpOwnerView(currentListing);
      }
      // Re-evaluate follow button visibility/state now that auth is known
      updateOwnerFollowBtnUI(currentListing);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    document.getElementById('detailSkeleton').innerHTML = `<div class="alert alert-danger">Failed to load room: ${e.message}</div>`;
  }
}

let galleryImages = [];
let galleryIndex = 0;

function renderGallery(images) {
  const gallery = document.getElementById('gallery');
  if (!images.length) {
    gallery.innerHTML = `<div class="gallery-main"><img src="/images/placeholder.jpg" alt="No image" /></div>`;
    return;
  }
  // Sort primary first, keep a stable gallery model
  galleryImages = [...images].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
  galleryIndex = 0;
  const many = galleryImages.length > 1;
  gallery.innerHTML = `
    <div class="gallery-main" id="galleryMain">
      <img src="${galleryImages[0].image_path}" alt="Photo 1" id="mainPhoto" />
      <span class="gallery-cover-badge" id="coverBadge"><i data-lucide="star"></i> Cover photo</span>
      ${many ? `
        <button class="gallery-nav prev" id="galPrev" aria-label="Previous photo">&#8249;</button>
        <button class="gallery-nav next" id="galNext" aria-label="Next photo">&#8250;</button>
        <span class="gallery-counter" id="galCounter">1 / ${galleryImages.length}</span>` : ''}
    </div>
    ${many ? `<div class="gallery-thumbs" id="galleryThumbs">${galleryImages.map((t, i) =>
      `<img src="${t.image_path}" alt="Photo ${i + 1}" data-index="${i}" class="${i === 0 ? 'active' : ''}" title="${i === 0 ? 'Cover photo' : 'Photo ' + (i + 1)}" />`).join('')}</div>` : ''}
    <div class="lightbox" id="galleryLightbox">
      <button class="lightbox-close" id="lbClose" aria-label="Close">&#10005;</button>
      ${many ? `<button class="lightbox-nav prev" id="lbPrev" aria-label="Previous">&#8249;</button>
      <button class="lightbox-nav next" id="lbNext" aria-label="Next">&#8250;</button>` : ''}
      <img src="${galleryImages[0].image_path}" alt="Photo fullscreen" id="lbImg" />
      ${many ? `<span class="lightbox-count" id="lbCount">1 / ${galleryImages.length}</span>` : ''}
    </div>`;

  if (!many) {
    document.getElementById('galleryMain').addEventListener('click', () => openLightbox());
    return;
  }

  const show = (i) => {
    galleryIndex = (i + galleryImages.length) % galleryImages.length;
    const src = galleryImages[galleryIndex].image_path;
    document.getElementById('mainPhoto').src = src;
    document.getElementById('galCounter').textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
    // The cover badge belongs to the primary photo only.
    const badge = document.getElementById('coverBadge');
    if (badge) badge.style.display = galleryIndex === 0 ? '' : 'none';
    document.querySelectorAll('#galleryThumbs img').forEach(t => t.classList.toggle('active', +t.dataset.index === galleryIndex));
    const activeThumb = document.querySelector('#galleryThumbs img.active');
    activeThumb?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  document.getElementById('galPrev').addEventListener('click', () => show(galleryIndex - 1));
  document.getElementById('galNext').addEventListener('click', () => show(galleryIndex + 1));
  document.getElementById('galleryThumbs').addEventListener('click', e => {
    const t = e.target.closest('img[data-index]');
    if (t) show(+t.dataset.index);
  });
  document.getElementById('mainPhoto').addEventListener('click', () => openLightbox());

  // Touch swipe
  let startX = null;
  const main = document.getElementById('galleryMain');
  main.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  main.addEventListener('touchend', e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(galleryIndex + (dx < 0 ? 1 : -1));
    startX = null;
  }, { passive: true });

  // Lightbox
  const lb = document.getElementById('galleryLightbox');
  const openLightboxAt = (i) => {
    show(i);
    document.getElementById('lbImg').src = galleryImages[galleryIndex].image_path;
    document.getElementById('lbCount').textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
    lb.classList.add('open');
  };
  window.openLightbox = () => openLightboxAt(galleryIndex);
  document.getElementById('lbClose').addEventListener('click', () => lb.classList.remove('open'));
  document.getElementById('lbPrev').addEventListener('click', () => openLightboxAt(galleryIndex - 1));
  document.getElementById('lbNext').addEventListener('click', () => openLightboxAt(galleryIndex + 1));
  lb.addEventListener('click', e => { if (e.target === lb) lb.classList.remove('open'); });
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') lb.classList.remove('open');
    if (e.key === 'ArrowLeft') openLightboxAt(galleryIndex - 1);
    if (e.key === 'ArrowRight') openLightboxAt(galleryIndex + 1);
  });
}

function renderBadges(listing) {
  const el = document.getElementById('listingBadges');
  const badges = [];
  if (listing.owner_verified) badges.push('<span class="badge badge-verified"><i data-lucide="badge-check" style="width:11px;height:11px"></i> Verified Owner</span>');
  if (listing.is_featured) badges.push('<span class="badge badge-featured"><i data-lucide="star" style="width:11px;height:11px"></i> Featured</span>');
  el.innerHTML = badges.join('');
}

function renderAmenities(a) {
  if (!a) return;
  const grid = document.getElementById('amenitiesGrid');
  const items = [
    AMENITY_MAP.water[a.water],
    AMENITY_MAP.electricity[a.electricity],
    AMENITY_MAP.security[a.security],
    AMENITY_MAP.furnishing[a.furnishing],
    AMENITY_MAP.bathroom[a.bathroom],
    a.wifi ? { icon: 'wifi', label: 'Wi-Fi Available' } : null,
    a.kitchen_access ? { icon: 'utensils', label: 'Kitchen Access' } : null,
    a.parking ? { icon: 'car', label: 'Parking Available' } : null,
    a.pet_friendly ? { icon: 'paw-print', label: 'Pet Friendly' } : null
  ].filter(Boolean);
  grid.innerHTML = items.map(item => `<div class="amenity-item"><i data-lucide="${item.icon}"></i><span>${item.label}</span></div>`).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [grid] });
}

function renderPriceBox(l) {
  document.getElementById('occupancyTag').textContent = `${l.occupancy_type}-in-1 Room`;
  document.getElementById('priceMain').textContent = `GHS ${Number(l.price_per_head).toLocaleString()}`;
  document.getElementById('pricePerHead').textContent = 'per person / year';
  document.getElementById('priceBreakdown').textContent = `${l.occupancy_type}-in-1 room`;
  document.getElementById('viewCount').textContent = l.views_count || 0;
  document.getElementById('interestCount').textContent = l.interest_count || 0;
  if (l.move_in_date) document.getElementById('moveInDate').innerHTML = `<i data-lucide="calendar" style="width:13px;height:13px"></i> Available from: ${new Date(l.move_in_date).toLocaleDateString()}`;

  // Poster card: avatar + name links to profile/all listings, follower count, follow button
  const posterHref = l.owner_id ? `/poster-profile?id=${l.owner_id}` : '#';
  const avatarLink = document.getElementById('ownerAvatarLink');
  const nameLink = document.getElementById('ownerNameLink');
  if (avatarLink) avatarLink.href = posterHref;
  if (nameLink) nameLink.href = posterHref;

  const avatarEl = document.getElementById('ownerAvatar');
  if (avatarEl) {
    avatarEl.textContent = (l.owner_name || 'O').charAt(0).toUpperCase();
    if (l.owner_avatar) {
      avatarEl.style.backgroundImage = `url(${l.owner_avatar})`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.textContent = '';
    }
  }

  const nameEl = document.getElementById('ownerName');
  if (nameEl) nameEl.textContent = l.owner_name || 'Verified Owner';

  const badgeEl = document.getElementById('ownerVerifiedBadge');
  if (badgeEl) {
    badgeEl.innerHTML = l.owner_verified
      ? '<span class="badge badge-verified" style="font-size:.65rem;padding:.15rem .45rem"><i data-lucide="badge-check" style="width:11px;height:11px"></i> Verified</span>'
      : '';
  }

  updateOwnerFollowersUI(l.owner_followers || 0);
  updateOwnerFollowBtnUI(l);
}

function updateOwnerFollowersUI(count) {
  const el = document.getElementById('ownerFollowersCount');
  if (!el) return;
  const c = Number(count) || 0;
  el.textContent = `${c} follower${c === 1 ? '' : 's'}`;
}

function updateOwnerFollowBtnUI(l) {
  const btn = document.getElementById('ownerFollowBtn');
  if (!btn) return;

  // Hide the follow button if it's the user's own listing or no owner
  if (!l || !l.owner_id || isOwnListing(l)) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';

  const isFollowing = !!l.is_following_owner;
  btn.classList.toggle('following', isFollowing);
  btn.innerHTML = isFollowing
    ? '<i data-lucide="user-check" style="width:13px;height:13px"></i> <span id="ownerFollowLabel">Following</span>'
    : '<i data-lucide="user-plus" style="width:13px;height:13px"></i> <span id="ownerFollowLabel">Follow</span>';
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

async function toggleFollowOwner() {
  if (!currentListing || !currentListing.owner_id) return;
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    return location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
  }
  if (isOwnListing(currentListing)) {
    return showToast("You can't follow yourself", 'error');
  }

  const btn = document.getElementById('ownerFollowBtn');
  if (btn) btn.disabled = true;
  try {
    const { following } = await api.post(`/api/users/${currentListing.owner_id}/follow`);
    currentListing.is_following_owner = following;
    const delta = following ? 1 : -1;
    currentListing.owner_followers = Math.max(0, (currentListing.owner_followers || 0) + delta);
    updateOwnerFollowBtnUI(currentListing);
    updateOwnerFollowersUI(currentListing.owner_followers);
    showToast(
      following
        ? `Following ${currentListing.owner_name || 'poster'} — you'll be notified when they post new rooms.`
        : `Unfollowed ${currentListing.owner_name || 'poster'}.`,
      'success'
    );
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── OWNER VIEW ──────────────────────────────
// The listing's own owner must not be able to send a request to, or favourite,
// their own room. Instead they get management actions: edit, deactivate /
// reactivate and permanently delete.
function isOwnListing(listing) {
  if (!listing || !localStorage.getItem('token')) return false;
  let user = null;
  try { user = JSON.parse(localStorage.getItem('user') || 'null'); } catch { return false; }
  if (!user) return false;
  if (user.role === 'admin') return true; // admins manage any listing
  return listing.owner_id != null && String(listing.owner_id) === String(user.id);
}

function setUpOwnerView(listing) {
  const seekerActions = document.getElementById('seekerActions');
  const ownerActions = document.getElementById('ownerActions');
  if (seekerActions) seekerActions.style.display = 'none';
  if (ownerActions) ownerActions.style.display = 'block';

  const editBtn = document.getElementById('editListingBtn');
  if (editBtn) editBtn.href = '/edit-listing?id=' + listing.uuid;

  refreshListingStatusUI(listing);
}

// Reflect the listing's current status on the deactivate / reactivate button.
function refreshListingStatusUI(listing) {
  const btn = document.getElementById('deactivateListingBtn');
  const label = document.getElementById('deactivateBtnLabel');
  if (!btn || !label) return;
  const inactive = listing.status === 'deactivated' || listing.status === 'unavailable';
  label.textContent = inactive ? 'Reactivate' : 'Deactivate';
  btn.querySelector('i')?.setAttribute('data-lucide', inactive ? 'play-circle' : 'pause-circle');
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

async function toggleListingActive() {
  if (!currentListing) return;
  const inactive = currentListing.status === 'deactivated' || currentListing.status === 'unavailable';
  const btn = document.getElementById('deactivateListingBtn');
  if (btn) btn.disabled = true;
  try {
    if (inactive) {
      await api.put(`/api/listings/${listingUUID}/reactivate`);
      currentListing.status = 'active';
      showToast('Room reactivated — it is live again.', 'success');
    } else {
      await api.delete(`/api/listings/${listingUUID}`);
      currentListing.status = 'deactivated';
      showToast('Room deactivated — hidden from seekers.', 'success');
    }
    refreshListingStatusUI(currentListing);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteListing() {
  if (!currentListing) return;
  if (!confirm('Permanently delete this room? This cannot be undone — photos, requests and reviews for it are removed too.')) return;
  try {
    await api.delete(`/api/listings/${listingUUID}/permanent`);
    showToast('Room deleted.', 'success');
    setTimeout(() => { location.href = '/listings'; }, 1000);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderReviews(reviews, avgRating, reviewCount) {
  const el = document.getElementById('reviewsList');
  if (!reviews.length) { el.innerHTML = '<p class="text-muted" style="font-size:0.875rem">No reviews yet.</p>'; return; }
  const stars = avgRating ? `${'★'.repeat(Math.round(avgRating))}${'☆'.repeat(5 - Math.round(avgRating))} ${avgRating}/5 (${reviewCount} reviews)` : '';
  el.innerHTML = `<div class="star-rating mb-2" style="font-size:1rem;color:#f59e0b">${stars}</div>` +
    reviews.map(r => `
      <div style="padding:1rem 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem">
          <strong style="font-size:0.875rem">${r.reviewer_name}</strong>
          <span style="color:#f59e0b">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
        </div>
        <p style="font-size:0.875rem;color:var(--text-muted)">${r.comment || ''}</p>
        <span class="text-muted" style="font-size:0.75rem">${new Date(r.created_at).toLocaleDateString()}</span>
      </div>`).join('');
}

function initMap(lat, lng, area) {
  const mapEl = document.getElementById('detail-map');
  if (!lat || !lng) {
    mapEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">${area}</div>`;
    return;
  }
  const map = L.map(mapEl, {
    scrollWheelZoom: false,
    tap: true,
    zoomSnap: 0.5,
    inertia: false // reduce jank on low-end mobile devices
  }).setView([lat, lng], 15);
  // fix: invalidateSize after render so the map doesn't overflow its container on mobile
  setTimeout(() => map.invalidateSize(), 200);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);
  L.circle([lat, lng], { radius: 200, color: '#FF6B6B', fillColor: '#FF6B6B', fillOpacity: 0.15, weight: 2 }).addTo(map)
    .bindPopup(`${area}<br><small>Approximate area — exact address shared after booking</small>`).openPopup();
}

function openInterestModal() {
  // Belt-and-braces: the server rejects this too, but never open the form for
  // someone trying to book their own room.
  if (isOwnListing(currentListing)) return showToast("You can't send a request to your own room", 'error');
  openModal('interestModal');
}
function openReportModal() { openModal('reportModal'); }

async function submitInterest(e) {
  e.preventDefault();
  const btn = document.getElementById('interestSubmitBtn');
  const phone = document.getElementById('intPhone').value;
  const email = document.getElementById('intEmail').value;
  if (!phone && !email) return showToast('Please provide phone or email', 'error');
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    await api.post('/api/requests', {
      listing_uuid: listingUUID,
      seeker_name: document.getElementById('intName').value,
      seeker_phone: phone || undefined,
      seeker_email: email || undefined,
      move_in_date: document.getElementById('intMoveIn').value || undefined,
      message: document.getElementById('intMessage').value || undefined
    });
    closeModal('interestModal');
    showToast('Request sent! We will contact you shortly.', 'success');
    document.getElementById('interestForm').reset();
  } catch (ex) {
    showToast(ex.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Send Request';
  }
}

async function submitReport(e) {
  e.preventDefault();
  try {
    await api.post(`/api/listings/${listingUUID}/report`, {
      reason: document.getElementById('reportReason').value,
      details: document.getElementById('reportDetails').value
    });
    closeModal('reportModal');
    showToast('Report submitted. Thank you.', 'success');
  } catch (ex) {
    showToast(ex.message, 'error');
  }
}

async function toggleFavorite() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) return location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
  if (isOwnListing(currentListing)) return showToast("You can't save your own room", 'error');
  try {
    const { favorited } = await api.post(`/api/listings/${listingUUID}/favorite`);
    const btn = document.getElementById('favBtn');
    btn.innerHTML = favorited
      ? '<i data-lucide="heart" style="width:20px;height:20px;fill:var(--primary);color:var(--primary)"></i>'
      : '<i data-lucide="heart" style="width:20px;height:20px"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
    showToast(favorited ? 'Saved to favorites' : 'Removed from favorites', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function calcDistance() {
  const from = document.getElementById('fromLocation').value;
  if (!from) return showToast('Enter a reference location', 'error');
  const resultEl = document.getElementById('distanceResult');
  const textEl = document.getElementById('distanceText');
  resultEl.style.display = 'none';
  if (from.toLowerCase().includes('my location') || from.toLowerCase().includes('current')) {
    navigator.geolocation?.getCurrentPosition(async pos => {
      await fetchDistance(pos.coords.latitude, pos.coords.longitude, resultEl, textEl);
    }, () => showToast('Could not get your location', 'error'));
    return;
  }
  showToast('Type "my location" to use GPS, or enter coordinates.', 'info');
}

async function fetchDistance(lat, lng, resultEl, textEl) {
  try {
    const data = await api.get(`/api/listings/${listingUUID}/distance?from_lat=${lat}&from_lng=${lng}`);
    textEl.innerHTML = `<i data-lucide="ruler" style="width:14px;height:14px"></i> Approximately ${data.distance_km} km away · ~${data.estimated_travel_minutes} min by road`;
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [textEl] });
    resultEl.style.display = 'block';
  } catch (e) { showToast(e.message, 'error'); }
}

loadListing();
