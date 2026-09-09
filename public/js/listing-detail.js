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
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    document.getElementById('detailSkeleton').innerHTML = `<div class="alert alert-danger">Failed to load listing: ${e.message}</div>`;
  }
}

function renderGallery(images) {
  const gallery = document.getElementById('gallery');
  if (!images.length) { gallery.innerHTML = `<img src="/images/placeholder.jpg" alt="No image" style="width:100%;height:420px;object-fit:cover;border-radius:var(--radius)" />`; return; }
  galleryImages = images.map(i => i.image_path);
  galleryIndex = 0;
  gallery.innerHTML = `
    <div class="gallery-main">
      <div class="gallery-track" id="galleryTrack">
        ${images.map(src => `<img src="${src}" alt="Listing photo" loading="lazy" />`).join('')}
      </div>
      ${images.length > 1 ? `
        <button class="gallery-nav prev" onclick="galleryMove(-1)" aria-label="Previous photo">‹</button>
        <button class="gallery-nav next" onclick="galleryMove(1)" aria-label="Next photo">›</button>
        <span class="gallery-counter" id="galleryCounter"></span>` : ''}
    </div>
    ${images.length > 1 ? `<div class="gallery-dots" id="galleryDots"></div>` : ''}`;
  updateGallery();
  setupGallerySwipe();
}

let galleryImages = [], galleryIndex = 0;

function updateGallery() {
  const track = document.getElementById('galleryTrack');
  if (!track) return;
  track.style.transform = `translateX(-${galleryIndex * 100}%)`;
  const counter = document.getElementById('galleryCounter');
  if (counter) counter.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;
  const dots = document.getElementById('galleryDots');
  if (dots) {
    dots.innerHTML = galleryImages.map((_, i) => `<button class="${i === galleryIndex ? 'active' : ''}" onclick="galleryGo(${i})" aria-label="Photo ${i + 1}"></button>`).join('');
  }
  const prev = document.querySelector('.gallery-nav.prev');
  const next = document.querySelector('.gallery-nav.next');
  if (prev) prev.classList.toggle('hidden', galleryIndex === 0);
  if (next) next.classList.toggle('hidden', galleryIndex === galleryImages.length - 1);
}

function galleryMove(dir) {
  galleryIndex = Math.min(Math.max(galleryIndex + dir, 0), galleryImages.length - 1);
  updateGallery();
}
function galleryGo(i) { galleryIndex = i; updateGallery(); }

function setupGallerySwipe() {
  const track = document.getElementById('galleryTrack');
  if (!track) return;
  let startX = 0, deltaX = 0, dragging = false;
  track.addEventListener('touchstart', e => { startX = e.touches[0].clientX; deltaX = 0; dragging = true; }, { passive: true });
  track.addEventListener('touchmove', e => {
    if (!dragging) return;
    deltaX = e.touches[0].clientX - startX;
    track.style.transition = 'none';
    track.style.transform = `translateX(calc(-${galleryIndex * 100}% + ${deltaX}px))`;
  }, { passive: true });
  track.addEventListener('touchend', () => {
    dragging = false;
    track.style.transition = '';
    if (Math.abs(deltaX) > 50) galleryMove(deltaX < 0 ? 1 : -1);
    else updateGallery();
  });
  // Click main photo to open the lightbox
  track.addEventListener('click', e => {
    if (Math.abs(deltaX) > 10) return;
    openLightbox(galleryIndex);
  });
}

function openLightbox(index) {
  if (!galleryImages.length) return;
  let el = document.getElementById('lightbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lightbox';
    el.className = 'lightbox';
    el.innerHTML = `
      <button class="lightbox-close" onclick="closeLightbox()" aria-label="Close">✕</button>
      <button class="lightbox-nav prev" onclick="lightboxMove(-1)" aria-label="Previous">‹</button>
      <img id="lightboxImg" src="" alt="Photo" />
      <button class="lightbox-nav next" onclick="lightboxMove(1)" aria-label="Next">›</button>
      <span class="lightbox-count" id="lightboxCount"></span>`;
    el.addEventListener('click', e => { if (e.target === el) closeLightbox(); });
    document.body.appendChild(el);
    document.addEventListener('keydown', e => {
      if (!el.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lightboxMove(-1);
      if (e.key === 'ArrowRight') lightboxMove(1);
    });
  }
  el.dataset.index = index;
  updateLightbox();
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function updateLightbox() {
  const el = document.getElementById('lightbox');
  const i = parseInt(el.dataset.index);
  document.getElementById('lightboxImg').src = galleryImages[i];
  document.getElementById('lightboxCount').textContent = `${i + 1} / ${galleryImages.length}`;
}

function lightboxMove(dir) {
  const el = document.getElementById('lightbox');
  let i = (parseInt(el.dataset.index) + dir + galleryImages.length) % galleryImages.length;
  el.dataset.index = i;
  updateLightbox();
}

function closeLightbox() {
  document.getElementById('lightbox')?.classList.remove('open');
  document.body.style.overflow = '';
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
  document.getElementById('priceMain').textContent = `GHS ${Number(l.listed_price).toLocaleString()}`;
  document.getElementById('pricePerHead').textContent = l.occupancy_type > 1 ? `GHS ${Number(l.price_per_head).toLocaleString()} per person` : 'Self-contained';
  document.getElementById('priceBreakdown').textContent = `GHS ${Number(l.listed_price).toLocaleString()}`;
  document.getElementById('ownerName').textContent = l.owner_name || 'Verified Owner';
  document.getElementById('viewCount').textContent = l.views_count || 0;
  document.getElementById('interestCount').textContent = l.interest_count || 0;
  if (l.move_in_date) document.getElementById('moveInDate').innerHTML = `<i data-lucide="calendar" style="width:13px;height:13px"></i> Available from: ${new Date(l.move_in_date).toLocaleDateString()}`;
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
  const map = L.map(mapEl).setView([lat, lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);
  L.circle([lat, lng], { radius: 200, color: '#FF6B6B', fillColor: '#FF6B6B', fillOpacity: 0.15, weight: 2 }).addTo(map)
    .bindPopup(`${area}<br><small>Approximate area — exact address shared after booking</small>`).openPopup();
}

function openInterestModal() { openModal('interestModal'); }
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
