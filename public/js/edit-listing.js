// Owner edit page: loads listing via /api/listings/:uuid/edit-data,
// prefills the form, and saves via PUT /api/listings/:uuid.
const editUUID = new URLSearchParams(location.search).get('id');
const MAX_PHOTOS = 10;

// Photos removed from the listing (listing_images.id) and files staged for upload.
let removedImageIds = [];
let newPhotoFiles = [];
let existingPhotoCount = 0;
let lastImages = []; // the listing's photos as loaded, for re-rendering on toggle

async function initEdit() {
  const user = await initNavAuth();
  if (!user) { location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search); return; }
  if (!['owner', 'agent', 'admin'].includes(user.role)) { location.href = '/dashboard'; return; }
  if (!editUUID) { location.href = '/dashboard#listings'; return; }

  try {
    const { listing, amenities, images } = await api.get(`/api/listings/${editUUID}/edit-data`);
    document.getElementById('editLoading').style.display = 'none';
    document.getElementById('editContent').style.display = 'block';
    document.title = `Edit: ${listing.title} — Roomy`;

    document.getElementById('edTitle').value = listing.title || '';
    document.getElementById('edDescription').value = listing.description || '';
    document.getElementById('edPrice').value = listing.original_price || listing.listed_price || '';
    document.getElementById('edOccupancy').value = String(listing.occupancy_type || 1);
    document.getElementById('edLocation').value = listing.location_area || '';
    document.getElementById('edLandmark').value = listing.nearest_landmark || '';
    if (amenities.water) document.getElementById('edWater').value = amenities.water;
    if (amenities.electricity) document.getElementById('edElectricity').value = amenities.electricity;
    if (amenities.furnishing) document.getElementById('edFurnishing').value = amenities.furnishing;
    if (amenities.bathroom) document.getElementById('edBathroom').value = amenities.bathroom;
    document.getElementById('edWifi').checked = !!amenities.wifi;
    document.getElementById('edKitchen').checked = !!amenities.kitchen_access;
    document.getElementById('edParking').checked = !!amenities.parking;
    document.getElementById('edPets').checked = !!amenities.pet_friendly;

    existingPhotoCount = images.length;
    lastImages = images;
    renderExistingPhotos(images);
    updatePhotoCount();

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    document.getElementById('editLoading').innerHTML = `<div class="alert alert-danger">Failed to load listing: ${e.message}</div><a href="/dashboard#listings" class="btn btn-outline mt-2">Back to dashboard</a>`;
  }
}

// ─── PHOTOS ───────────────────
// Owners can remove existing photos and add new ones, capped at 10 in total.
function totalPhotoCount() {
  return (existingPhotoCount - removedImageIds.length) + newPhotoFiles.length;
}

function updatePhotoCount() {
  const el = document.getElementById('photoCount');
  if (el) el.textContent = totalPhotoCount();

  const drop = document.getElementById('photoDropzone');
  const atMax = totalPhotoCount() >= MAX_PHOTOS;
  if (drop) {
    drop.style.opacity = atMax ? '.5' : '';
    drop.style.pointerEvents = atMax ? 'none' : '';
    const small = drop.querySelector('small');
    if (small) small.textContent = atMax
      ? 'Photo limit reached — remove one to add another'
      : 'JPG, PNG or WebP · up to 10 photos per listing';
  }
}

function showPhotoError(msg) {
  const el = document.getElementById('photoError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function renderExistingPhotos(images) {
  const wrap = document.getElementById('currentPhotos');
  if (!images.length) {
    wrap.innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:.85rem">No photos yet — add one below.</p>';
    return;
  }
  wrap.innerHTML = images.map(img => {
    const removed = removedImageIds.includes(img.id);
    return `<div class="photo-tile ${removed ? 'removing' : ''}" data-id="${img.id}">
      <img src="${img.image_path}" alt="Listing photo" loading="lazy" />
      ${img.is_primary ? '<span class="photo-primary-tag">Main</span>' : ''}
      <button type="button" class="photo-remove" title="${removed ? 'Undo remove' : 'Remove photo'}"
        onclick="toggleRemovePhoto(${img.id})">${removed ? '&#8635;' : '&#10005;'}</button>
    </div>`;
  }).join('');
}

function toggleRemovePhoto(id) {
  if (removedImageIds.includes(id)) removedImageIds = removedImageIds.filter(x => x !== id);
  else removedImageIds.push(id);
  showPhotoError('');
  renderExistingPhotos(lastImages);
  updatePhotoCount();
}
window.toggleRemovePhoto = toggleRemovePhoto;

function renderNewPhotos() {
  const wrap = document.getElementById('newPhotos');
  wrap.innerHTML = newPhotoFiles.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div class="photo-tile">
      <img src="${url}" alt="New photo" />
      <button type="button" class="photo-remove" title="Remove" onclick="removeNewPhoto(${i})">&#10005;</button>
    </div>`;
  }).join('');
}

function removeNewPhoto(i) {
  newPhotoFiles.splice(i, 1);
  showPhotoError('');
  renderNewPhotos();
  updatePhotoCount();
}
window.removeNewPhoto = removeNewPhoto;

function handleNewPhotoSelect(files) {
  const incoming = Array.from(files);
  const room = MAX_PHOTOS - totalPhotoCount();
  if (incoming.length > room) {
    showPhotoError(`You can only add ${Math.max(room, 0)} more photo${room === 1 ? '' : 's'} — a listing allows ${MAX_PHOTOS}.`);
  } else {
    showPhotoError('');
  }
  newPhotoFiles.push(...incoming.slice(0, Math.max(room, 0)));
  renderNewPhotos();
  updatePhotoCount();
}

document.getElementById('edNewPhotos')?.addEventListener('change', (e) => {
  handleNewPhotoSelect(e.target.files);
  e.target.value = ''; // allow re-selecting the same file
});

document.getElementById('editForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('editSubmitBtn');
  const errEl = document.getElementById('editError');
  errEl.style.display = 'none';
  btn.disabled = true; btn.classList.add('btn-loading');
  // Photos must go as multipart, so the whole update is sent as FormData.
  // The server sets the same text fields it always did and applies the photo changes.
  if (totalPhotoCount() < 1) {
    errEl.textContent = 'A listing needs at least one photo.';
    errEl.style.display = 'block';
    btn.disabled = false; btn.classList.remove('btn-loading');
    return;
  }
  try {
    const fd = new FormData();
    fd.append('title', document.getElementById('edTitle').value.trim());
    fd.append('description', document.getElementById('edDescription').value.trim());
    fd.append('original_price', document.getElementById('edPrice').value);
    fd.append('occupancy_type', document.getElementById('edOccupancy').value);
    fd.append('location_area', document.getElementById('edLocation').value.trim());
    fd.append('nearest_landmark', document.getElementById('edLandmark').value.trim());
    fd.append('water', document.getElementById('edWater').value);
    fd.append('electricity', document.getElementById('edElectricity').value);
    fd.append('furnishing', document.getElementById('edFurnishing').value);
    fd.append('bathroom', document.getElementById('edBathroom').value);
    fd.append('wifi', document.getElementById('edWifi').checked);
    fd.append('kitchen_access', document.getElementById('edKitchen').checked);
    fd.append('parking', document.getElementById('edParking').checked);
    fd.append('pet_friendly', document.getElementById('edPets').checked);
    fd.append('remove_image_ids', JSON.stringify(removedImageIds));
    newPhotoFiles.forEach(f => fd.append('images', f));

    await api.upload(`/api/listings/${editUUID}`, fd, 'PUT');
    showToast('Changes saved! Resubmitted for review.', 'success');
    setTimeout(() => location.href = '/dashboard#listings', 1200);
  } catch (ex) {
    errEl.textContent = ex.message;
    errEl.style.display = 'block';
    btn.disabled = false; btn.classList.remove('btn-loading');
  }
});

initEdit();
