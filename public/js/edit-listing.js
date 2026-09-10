// Owner edit page: loads listing via /api/listings/:uuid/edit-data,
// prefills the form, and saves via PUT /api/listings/:uuid.
const editUUID = new URLSearchParams(location.search).get('id');
const MAX_PHOTOS = 10;

// A single ordered photo list drives both display and the saved order.
// Each entry is either:
//   { key: 'i:<listing_images.id>', type: 'existing', id, path }
//   { key: 'n:<index>',            type: 'new',      file, url }
// The FIRST entry is the cover photo. Reordering happens by moving entries here.
let photoItems = [];
let newPhotoFiles = []; // staged uploads, in the order they were chosen
let removedImageIds = []; // existing ids the owner removed (undone by re-adding from the grid)

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

    // images arrive ordered by sort_order; the first is the current cover.
    photoItems = images.map(img => ({ key: 'i:' + img.id, type: 'existing', id: img.id, path: img.image_path }));
    renderPhotoGrid();
    updatePhotoCount();

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    document.getElementById('editLoading').innerHTML = `<div class="alert alert-danger">Failed to load listing: ${e.message}</div><a href="/dashboard#listings" class="btn btn-outline mt-2">Back to dashboard</a>`;
  }
}

// ─── PHOTOS ───────────────────
// Owners can remove, add and REORDER photos (capped at 10). The first photo in
// the list is the cover. Reordering is drag-and-drop, with click-to-swap on
// touch screens where HTML5 drag events aren't available.
function totalPhotoCount() {
  return photoItems.length;
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

function renderPhotoGrid() {
  const wrap = document.getElementById('photoGrid');
  if (!wrap) return;
  if (!photoItems.length) {
    wrap.innerHTML = '<p class="text-muted" style="grid-column:1/-1;font-size:.85rem">No photos yet — add one below.</p>';
    return;
  }
  wrap.innerHTML = photoItems.map((item, i) => {
    const src = item.type === 'existing' ? item.path : item.url;
    return `<div class="photo-tile" draggable="true" data-key="${item.key}" data-index="${i}" title="Drag to reorder">
      <img src="${src}" alt="Listing photo ${i + 1}" loading="lazy" draggable="false" />
      <span class="photo-drag-handle"><i data-lucide="grip-vertical"></i></span>
      ${i === 0 ? '<span class="photo-primary-tag">Cover photo</span>' : `<span class="photo-order-tag">${i + 1}</span>`}
      <button type="button" class="photo-remove" title="Remove photo" onclick="removePhotoAt(${i})">&#10005;</button>
    </div>`;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [wrap] });
  initPhotoDrag();
}

function removePhotoAt(index) {
  const [item] = photoItems.splice(index, 1);
  if (item && item.type === 'existing') {
    removedImageIds.push(item.id);
  } else if (item && item.type === 'new') {
    newPhotoFiles = newPhotoFiles.filter(f => f !== item.file);
  }
  showPhotoError('');
  renderPhotoGrid();
  updatePhotoCount();
}
window.removePhotoAt = removePhotoAt;

// ── Drag & drop reordering ─────────────────────────────
let dragFromIndex = null;

function initPhotoDrag() {
  const wrap = document.getElementById('photoGrid');
  if (!wrap) return;
  const tiles = [...wrap.querySelectorAll('.photo-tile')];

  tiles.forEach((tile) => {
    tile.addEventListener('dragstart', (e) => {
      dragFromIndex = Number(tile.dataset.index);
      tile.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox needs some data set for a drag to start.
      try { e.dataTransfer.setData('text/plain', tile.dataset.key); } catch { /* ignore */ }
    });
    tile.addEventListener('dragend', () => {
      tile.classList.remove('dragging');
      wrap.querySelectorAll('.photo-tile').forEach(t => t.classList.remove('drag-over'));
      dragFromIndex = null;
    });
    tile.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tile.classList.add('drag-over');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      tile.classList.remove('drag-over');
      const toIndex = Number(tile.dataset.index);
      movePhoto(dragFromIndex, toIndex);
    });

    // Touch fallback: tap a photo to select it, tap another to place it there.
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.photo-remove')) return;
      handlePhotoTap(Number(tile.dataset.index));
    });
  });
}

let selectedPhotoIndex = null;
function handlePhotoTap(index) {
  const wrap = document.getElementById('photoGrid');
  if (selectedPhotoIndex === null) {
    selectedPhotoIndex = index;
    wrap.querySelectorAll('.photo-tile').forEach(t =>
      t.classList.toggle('selected', Number(t.dataset.index) === index));
    return;
  }
  if (selectedPhotoIndex !== index) movePhoto(selectedPhotoIndex, index);
  selectedPhotoIndex = null;
  wrap.querySelectorAll('.photo-tile').forEach(t => t.classList.remove('selected'));
}

function movePhoto(from, to) {
  if (from === null || to === null || Number.isNaN(from) || Number.isNaN(to) || from === to) return;
  if (from < 0 || to < 0 || from >= photoItems.length || to >= photoItems.length) return;
  const [item] = photoItems.splice(from, 1);
  photoItems.splice(to, 0, item);
  showPhotoError('');
  renderPhotoGrid();
  updatePhotoCount();
}

window.movePhoto = movePhoto; // exposed so the drag/tap logic is testable
function handleNewPhotoSelect(files) {
  const incoming = Array.from(files);
  const room = MAX_PHOTOS - totalPhotoCount();
  if (incoming.length > room) {
    showPhotoError(`You can only add ${Math.max(room, 0)} more photo${room === 1 ? '' : 's'} — a listing allows ${MAX_PHOTOS}.`);
  } else {
    showPhotoError('');
  }
  const accepted = incoming.slice(0, Math.max(room, 0));
  accepted.forEach(f => {
    newPhotoFiles.push(f);
    photoItems.push({ key: 'n:' + (newPhotoFiles.length - 1), type: 'new', file: f, url: URL.createObjectURL(f) });
  });
  renderPhotoGrid();
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
    // Upload files in the exact order they appear in the grid, and send the
    // matching ordering so the server can persist sort_order + cover photo.
    const orderedNewFiles = [];
    const photoOrder = photoItems.map(item => {
      if (item.type === 'new') {
        orderedNewFiles.push(item.file);
        return 'new:' + (orderedNewFiles.length - 1);
      }
      return item.id;
    });
    orderedNewFiles.forEach(f => fd.append('images', f));
    fd.append('photo_order', JSON.stringify(photoOrder));

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
