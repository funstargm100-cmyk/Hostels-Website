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

// ─── LOCATION MAP ─────────────────────────────
let editMap = null;
let editMarker = null;
let editInitialLat = null; // saved coords, restored onto the map
let editInitialLng = null;

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
    // Seed the hidden location fields with the saved coords so the map can restore
    // the pin, and so saving without touching the map keeps the location intact.
    editInitialLat = listing.location_lat != null ? Number(listing.location_lat) : null;
    editInitialLng = listing.location_lng != null ? Number(listing.location_lng) : null;
    document.getElementById('edFullAddress').value = listing.full_address || '';
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

    initEditMap();

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    document.getElementById('editLoading').innerHTML = `<div class="alert alert-danger">Failed to load room: ${e.message}</div><a href="/dashboard#listings" class="btn btn-outline mt-2">Back to dashboard</a>`;
  }
}

// ─── LOCATION MAP (LEAFLET) ───────────────────
// Mirrors the map on the post-ad page so owners can correct the pin while editing.
function initEditMap() {
  const el = document.getElementById('editMap');
  if (!el || typeof L === 'undefined') return;
  if (editMap) { editMap.invalidateSize(); return; }

  const defaultLat = 5.6037; // Accra, Ghana
  const defaultLng = -0.1870;
  const startLat = editInitialLat != null ? editInitialLat : defaultLat;
  const startLng = editInitialLng != null ? editInitialLng : defaultLng;

  editMap = L.map(el).setView([startLat, startLng], editInitialLat != null ? 16 : 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(editMap);

  // Restore the saved pin (no reverse-geocode — the area/landmark fields already hold it).
  if (editInitialLat != null && editInitialLng != null) {
    placeEditPin(editInitialLat, editInitialLng, false);
  } else {
    document.getElementById('editPinStatus').textContent = 'No pin set — tap the map to place one.';
  }

  editMap.on('click', (e) => placeEditPin(e.latlng.lat, e.latlng.lng, true));
  // The container may have been hidden while the form rendered; size it now.
  setTimeout(() => editMap.invalidateSize(), 150);
}

function placeEditPin(lat, lng, reverseGeocode) {
  if (editMarker) editMap.removeLayer(editMarker);
  editMarker = L.marker([lat, lng], { draggable: true }).addTo(editMap);
  editMarker.bindPopup('Room location').openPopup();
  editMarker.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    setEditLocationFields(pos.lat, pos.lng, true);
  });
  setEditLocationFields(lat, lng, reverseGeocode);
}

function setEditLocationFields(lat, lng, reverseGeocode) {
  document.getElementById('edLat').value = lat.toFixed(7);
  document.getElementById('edLng').value = lng.toFixed(7);
  document.getElementById('editPinStatus').textContent = 'Pin set at ' + lat.toFixed(5) + ', ' + lng.toFixed(5);
  if (reverseGeocode) reverseGeocodeEditPin(lat, lng);
}

async function reverseGeocodeEditPin(lat, lng) {
  const status = document.getElementById('editPinStatus');
  status.textContent = 'Looking up address...';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, {
      headers: { 'Accept-Language': 'en' }
    });
    const data = await res.json();
    if (!data.address) return;
    const addr = data.address;
    const area = addr.suburb || addr.neighbourhood || addr.quarter || addr.town || addr.city || addr.county || addr.state || '';
    const city = addr.city || addr.town || addr.county || '';
    const areaFull = area && city && area !== city ? `${area}, ${city}` : area || city;
    if (areaFull) document.getElementById('edLocation').value = areaFull;
    if (data.display_name) document.getElementById('edFullAddress').value = data.display_name;
    status.textContent = areaFull || 'Location pinned';
  } catch {
    status.textContent = 'Pin set at ' + parseFloat(document.getElementById('edLat').value).toFixed(5) + ', ' + parseFloat(document.getElementById('edLng').value).toFixed(5);
  }
}

function getMyEditLocation() {
  if (!navigator.geolocation) return showToast('Geolocation not supported', 'error');
  document.getElementById('editPinStatus').textContent = 'Getting your location...';
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (!editMap) initEditMap();
    editMap.setView([lat, lng], 17);
    placeEditPin(lat, lng, true);
  }, () => showToast('Could not get location. Please pin manually.', 'error'));
}
window.getMyEditLocation = getMyEditLocation;

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
      : 'JPG, PNG or WebP · up to 10 photos per room';
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
      <img src="${src}" alt="Room photo ${i + 1}" loading="lazy" draggable="false" />
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
// A drag's trailing click (if the browser fires one on the drop target) must
// never be mistaken for the first tap of a tap-to-swap. Set on dragstart,
// cleared on the next genuine mousedown.
let suppressTap = false;

function initPhotoDrag() {
  const wrap = document.getElementById('photoGrid');
  if (!wrap) return;
  const tiles = [...wrap.querySelectorAll('.photo-tile')];

  tiles.forEach((tile) => {
    tile.addEventListener('dragstart', (e) => {
      dragFromIndex = Number(tile.dataset.index);
      suppressTap = true;
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
    tile.addEventListener('mousedown', () => { suppressTap = false; });
    tile.addEventListener('click', (e) => {
      // The click trailing a drag lands on the drop target — not a tap.
      if (suppressTap) return;
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
  if (selectedPhotoIndex !== index) swapPhotos(selectedPhotoIndex, index);
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

// Tap-to-tap swaps the two photos (positions exchange, everything else stays).
// Drag-and-drop keeps its shift behaviour; only the tap path swaps.
function swapPhotos(a, b) {
  if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b) || a === b) return;
  if (a < 0 || b < 0 || a >= photoItems.length || b >= photoItems.length) return;
  [photoItems[a], photoItems[b]] = [photoItems[b], photoItems[a]];
  showPhotoError('');
  renderPhotoGrid();
  updatePhotoCount();
}
window.swapPhotos = swapPhotos; // exposed for QA
function handleNewPhotoSelect(files) {
  const incoming = Array.from(files);
  const room = MAX_PHOTOS - totalPhotoCount();
  if (incoming.length > room) {
    showPhotoError(`You can only add ${Math.max(room, 0)} more photo${room === 1 ? '' : 's'} — a room allows ${MAX_PHOTOS}.`);
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
    errEl.textContent = 'A room needs at least one photo.';
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
    fd.append('location_lat', document.getElementById('edLat').value);
    fd.append('location_lng', document.getElementById('edLng').value);
    fd.append('full_address', document.getElementById('edFullAddress').value);
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
    showToast('Changes saved!', 'success');
    setTimeout(() => location.href = '/dashboard#listings', 1200);
  } catch (ex) {
    errEl.textContent = ex.message;
    errEl.style.display = 'block';
    btn.disabled = false; btn.classList.remove('btn-loading');
  }
});

initEdit();
