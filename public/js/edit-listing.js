// Owner edit page: loads listing via /api/listings/:uuid/edit-data,
// prefills the form, and saves via PUT /api/listings/:uuid.
const editUUID = new URLSearchParams(location.search).get('id');
const MAX_PHOTOS = 10;

// ─── PRICING ─────────────────
// The edit form only changes the BASE price per head. Commission and platform fee
// are properties fixed when the room was posted, so we read them from the listing
// and recompute the totals here — mirroring POST /api/listings exactly. Keep these
// in sync with src/routes/listings.js.
const PLATFORM_FEE_RATE = { owner: 0.07, agent: 0.05 };
let editPricing = { posterType: 'owner', commissionPerPerson: 0 };

// ─── UNSAVED-CHANGES GUARD ────────────────────────────────
// Warn before leaving if the owner has edited any field or touched the photos.
// Read by the Back button, the Cancel link and the browser unload guard (app.js).
let _saved = false;              // true once a save succeeds — leaving is then silent
let _initialFieldSnapshot = null;
let _initialPhotoSignature = '';

function _editFieldsSnapshot() {
  const form = document.getElementById('editForm');
  if (!form) return {};
  const snap = {};
  form.querySelectorAll('input, select, textarea').forEach((el) => {
    if (!el.id) return;
    if (el.type === 'checkbox') { if (el.checked) snap[el.id] = true; }
    else if (el.value) snap[el.id] = el.value;
  });
  return snap;
}

// A compact signature of the photo set (existing ids + staged files, in order).
function _photoSignature() {
  return photoItems.map(it => it.type === 'existing' ? 'i' + it.id : 'n' + (it.file ? it.file.name + it.file.size : '')).join('|');
}

function _captureEditBaseline() {
  _initialFieldSnapshot = _editFieldsSnapshot();
  _initialPhotoSignature = _photoSignature();
}

window.hasUnsavedChanges = function () {
  if (_saved) return false;
  if (_initialFieldSnapshot == null) return false;
  if (JSON.stringify(_editFieldsSnapshot()) !== JSON.stringify(_initialFieldSnapshot)) return true;
  return _photoSignature() !== _initialPhotoSignature;
};

// Cancel link / any hash link to the dashboard — routed through the same guard.
window.confirmLeaveIfDirty = function (href) {
  if (window.hasUnsavedChanges()) { confirmLeave(() => { location.href = href; }); return false; }
  location.href = href;
  return false;
};

// The base price per head for the loaded listing. New rooms store it directly in
// base_price_per_head; older rooms are backfilled by the schema migration, and if
// it is still missing we reverse the forward formula as a fallback.
function deriveBasePricePerHead(listing) {
  if (listing.base_price_per_head != null && Number.isFinite(Number(listing.base_price_per_head))) {
    return Number(listing.base_price_per_head);
  }
  const occ = Number(listing.occupancy_type) || 1;
  const total = Number(listing.price_per_head) || 0;
  if (listing.poster_type === 'agent' && Number.isFinite(Number(listing.commission_value))) {
    const c = Number(listing.commission_value);
    return Math.max((total - c * (1 + 0.05 * occ * occ)) / 1.05, 0);
  }
  return total / 1.07;
}

// Recompute and display commission, platform fee and totals from the current base
// price + occupancy. Same sequence as the server so the preview matches the save.
function updatePricePreview() {
  const preview = document.getElementById('pricePreview');
  if (!preview) return;
  const base = parseFloat(document.getElementById('edPrice').value);
  const occ = parseInt(document.getElementById('edOccupancy').value, 10) || 1;
  if (!Number.isFinite(base) || base <= 0) { preview.style.display = 'none'; return; }

  const isAgent = editPricing.posterType === 'agent';
  const rate = PLATFORM_FEE_RATE[editPricing.posterType] || PLATFORM_FEE_RATE.owner;
  const commValue = isAgent ? editPricing.commissionPerPerson : 0;
  const commission = isAgent ? parseFloat((commValue * occ).toFixed(2)) : 0;
  const feeBasePerPerson = isAgent ? parseFloat(((commission * occ) + base).toFixed(2)) : base;
  const platformFee = parseFloat((feeBasePerPerson * rate).toFixed(2));
  const totalPerPerson = parseFloat((base + commValue + platformFee).toFixed(2));

  const ghs = (n) => 'GHS ' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const commissionRow = document.getElementById('prevCommission');
  const feeBaseRow = document.getElementById('prevFeeBase');
  if (isAgent) {
    commissionRow.textContent = `Total commission for ${occ} occupant${occ === 1 ? '' : 's'}: ${ghs(commission)}`;
    commissionRow.style.display = 'flex';
    feeBaseRow.textContent = `Commission per occupant: ${ghs(commValue)}`;
    feeBaseRow.style.display = 'flex';
  } else {
    commissionRow.style.display = 'none';
    feeBaseRow.style.display = 'none';
  }
  document.getElementById('prevFeeLabel').textContent = `Platform fee (${Math.round(rate * 100)}%)`;
  document.getElementById('prevPlatformFee').textContent = ghs(platformFee);
  document.getElementById('prevPerHead').textContent = `${ghs(totalPerPerson)} / person`;
  preview.style.display = 'block';
}
window.updatePricePreview = updatePricePreview;
// The "what's left" prompt is transient — auto-clear it after a few seconds so it
// never sits on the form blocking the view once the user has read it.
const PROMPT_TIMEOUT_MS = 4000;
let editPromptTimer = null;

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
    document.title = `Edit: ${listing.title} — Rentel`;

    document.getElementById('edTitle').value = listing.title || '';
    document.getElementById('edDescription').value = listing.description || '';
    // The form edits the BASE price per head (before commission + platform fee), so
    // pre-fill from base_price_per_head rather than the stored total.
    document.getElementById('edPrice').value = deriveBasePricePerHead(listing).toFixed(2);
    document.getElementById('edOccupancy').value = String(listing.occupancy_type || 1);
    // Commission + poster type are fixed at post time and shown in the fee preview.
    editPricing = {
      posterType: listing.poster_type === 'agent' ? 'agent' : 'owner',
      commissionPerPerson: Number.isFinite(Number(listing.commission_value)) ? Number(listing.commission_value) : 0
    };
    // Rooms created before the gender field existed have no value — default them to
    // "Any" (stored as 'mixed') so the select always shows a valid choice.
    document.getElementById('edGender').value = listing.gender_preference || 'mixed';
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

    // Show the derived commission / platform fee / total for the loaded price.
    updatePricePreview();

    // images arrive ordered by sort_order; the first is the current cover.
    photoItems = images.map(img => ({ key: 'i:' + img.id, type: 'existing', id: img.id, path: img.image_path }));
    renderPhotoGrid();
    updatePhotoCount();

    initEditMap();

    // Baseline AFTER the form is fully pre-filled, so the loaded values are not
    // mistaken for the owner's own unsaved edits.
    _captureEditBaseline();

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
  // Permanent label, not an auto-opening popup — see placePin in post-ad.js.
  editMarker.bindTooltip('Drag to fine-tune the pin', {
    permanent: true, direction: 'top', className: 'map-pin-label', offset: [0, -12]
  });
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
    // Newly-chosen files use their in-memory object URL; already-saved photos go
    // through the shared thumbnail endpoint like every other card-sized image.
    const src = item.type === 'existing' ? thumbUrl(item.path) : item.url;
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

// Same rules as posting a room: every form field must be filled and the room
// must keep at least 2 photos. Returns an error string, or '' when valid.
function validateEditForm() {
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  if (!val('edTitle')) return 'Title is required.';
  if (!val('edDescription')) return 'Description is required.';
  if (!val('edPrice')) return 'Enter a base price per person.';
  if (!val('edOccupancy')) return 'Select the occupancy type.';
  if (!val('edLocation')) return 'Location area is required.';
  if (!val('edLandmark')) return 'Nearest landmark is required.';
  if (!val('edLat') || !val('edLng')) return 'Please place a pin on the map to set the location.';
  // Amenity selects all start on a real value, so validate anyway so every field
  // on the form is genuinely filled.
  if (!val('edWater')) return 'Select a water supply.';
  if (!val('edElectricity')) return 'Select an electricity supply.';
  if (!val('edFurnishing')) return 'Select the furnishing.';
  if (!val('edBathroom')) return 'Select the bathroom type.';
  if (totalPhotoCount() < 2) return 'A room needs at least 2 photos.';
  return '';
}

document.getElementById('editForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('editSubmitBtn');
  const errEl = document.getElementById('editError');
  clearTimeout(editPromptTimer);
  errEl.style.display = 'none';
  // Validate BEFORE disabling the button, so a failed check leaves it usable.
  const invalid = validateEditForm();
  if (invalid) {
    errEl.textContent = invalid;
    errEl.style.display = 'block';
    errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Auto-dismiss the prompt after a timeout.
    editPromptTimer = setTimeout(() => {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }, PROMPT_TIMEOUT_MS);
    return;
  }
  btn.disabled = true; btn.classList.add('btn-loading');
  // Photos must go as multipart, so the whole update is sent as FormData.
  // The server sets the same text fields it always did and applies the photo changes.
  try {
    const fd = new FormData();
    fd.append('title', document.getElementById('edTitle').value.trim());
    fd.append('description', document.getElementById('edDescription').value.trim());
    fd.append('price_per_head', document.getElementById('edPrice').value);
    fd.append('occupancy_type', document.getElementById('edOccupancy').value);
    fd.append('gender_preference', document.getElementById('edGender').value || 'mixed');
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
    // Compress the NEW uploads before sending. The whole update (fields + every
    // staged photo) travels in one multipart body, and the platform rejects a
    // body over ~4.5MB with FUNCTION_PAYLOAD_TOO_LARGE. It must happen before
    // they are appended, hence after photoOrder is built.
    const compressedNew = await compressImages(orderedNewFiles, {}, (done, total) => {
      btn.textContent = `Optimising photo ${done}/${total}...`;
    });
    compressedNew.forEach(r => fd.append('images', r.file));
    fd.append('photo_order', JSON.stringify(photoOrder));

    await api.upload(`/api/listings/${editUUID}`, fd, 'PUT');
    // Saved — the redirect below must not trigger the unsaved-changes warning.
    _saved = true;
    showToast('Changes saved!', 'success');
    setTimeout(() => location.href = '/dashboard#listings', 1200);
  } catch (ex) {
    // Translate the platform's 413 into something the user can act on.
    errEl.textContent = /PAYLOAD_TOO_LARGE|413|too large/i.test(ex.message)
      ? 'The photos are too large to upload together. Try removing one or two, then save again.'
      : ex.message;
    errEl.style.display = 'block';
    btn.disabled = false; btn.classList.remove('btn-loading');
  }
});

initEdit();
