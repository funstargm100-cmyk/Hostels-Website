let currentStep = 1;
const TOTAL_STEPS = 6;
let coverFile = null;       // required: the entire-building photo (becomes the cover)
let selectedFiles = [];     // optional: room/feature photos
let postMap = null;
let postMarker = null;
// Auto-dismiss timing for the "what's left" prompts. A prompt is transient — it
// tells the user what to fix right now; once read it clears itself so it never
// sits on the step blocking the view. Keyed per error element so re-showing a
// prompt resets its own clock (a WeakMap lets the element be collected normally).
const PROMPT_TIMEOUT_MS = 4000;
const promptTimers = new WeakMap();

// ─── AUTH GATE ────────────────────────────────────────────────────────────────
async function checkAuth() {
  const user = await initNavAuth();
  if (!user) { location.href = '/login?redirect=/post-ad'; return; }
  if (user.role === 'seeker') {
    document.getElementById('wizardContainer').innerHTML = '<div class="card" style="padding:2rem;text-align:center"><div style="font-size:3rem;margin-bottom:1rem">🚫</div><h2>Owners Only</h2><p class="text-muted mt-1 mb-3">Only owners and agents can post rooms. Sign up with an owner account to list a room.</p><a href="/signup" class="btn btn-primary btn-lg">Create Owner Account</a></div>';
  }
}

// ─── WIZARD NAVIGATION ────────────────────────────────────────────────────────
function updateWizardUI() {
  document.querySelectorAll('.wizard-panel').forEach((p, i) => {
    p.classList.toggle('active', i + 1 === currentStep);
  });
  document.querySelectorAll('.wizard-step').forEach((s, i) => {
    s.classList.toggle('active', i + 1 === currentStep);
    s.classList.toggle('done', i + 1 < currentStep);
  });
  document.getElementById('prevBtn').style.display = currentStep > 1 ? '' : 'none';
  document.getElementById('nextBtn').style.display = currentStep < TOTAL_STEPS ? '' : 'none';
  document.getElementById('submitBtn').style.display = currentStep === TOTAL_STEPS ? '' : 'none';
  // Clear any step's leftover "what's left" prompt for steps we are LEAVING, so a
  // stale message never greets the user on a step they already completed.
  document.querySelectorAll('.wizard-panel').forEach((p, i) => {
    if (i + 1 !== currentStep) {
      const err = p.querySelector('.alert-danger');
      if (err) { clearTimeout(promptTimers.get(err)); err.innerHTML = ''; err.style.display = 'none'; }
    }
  });
  if (currentStep === 5) initPostMap();
  if (currentStep === TOTAL_STEPS) buildReviewSummary();
}

function wizardNext() {
  if (!validateStep(currentStep)) return;
  currentStep++;
  updateWizardUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function wizardPrev() {
  currentStep--;
  updateWizardUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// What is still missing ON A GIVEN STEP, as a list of human-readable items.
// Collecting them all (rather than bailing on the first) lets the step show a
// single "what's left" prompt instead of making the user fix one field per click.
function missingFieldsForStep(step) {
  const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  const missing = [];
  if (step === 1) {
    // A room needs at least TWO photos: the cover (entire building) plus at least
    // one more. The cover is held separately, so the total is cover + selectedFiles.
    if (!coverFile) missing.push('Cover photo of the whole building');
    if (selectedFiles.length > 9) missing.push('At most 9 extra photos (you have ' + selectedFiles.length + ')');
    else if (1 + selectedFiles.length < 2) missing.push('At least 1 more photo (2 in total)');
  }
  if (step === 2) {
    if (!val('adTitle')) missing.push('Title');
    if (!val('adDescription')) missing.push('Description');
  }
  if (step === 3) {
    if (!val('adOccupancy')) missing.push('Occupancy type');
    if (!val('adOriginalPrice')) missing.push('Price per person');
  }
  if (step === 4) {
    // Amenity selects all start on a real value, so an empty one means the user
    // went out of their way to unset it — but validate anyway so every field on
    // the step is genuinely filled.
    if (!val('edWater')) missing.push('Water supply');
    if (!val('edElectricity')) missing.push('Electricity');
    if (!val('edFurnishing')) missing.push('Furnishing');
    if (!val('edBathroom')) missing.push('Bathroom type');
  }
  if (step === 5) {
    if (!val('adLat') || !val('adLng')) missing.push('Map pin (tap the map to set the location)');
    if (!val('adLocationArea')) missing.push('Location area');
    if (!val('adLandmark')) missing.push('Nearest landmark');
  }
  return missing;
}

function clearPromptSoon(errEl) {
  if (!errEl) return;
  clearTimeout(promptTimers.get(errEl));
  const t = setTimeout(() => {
    errEl.innerHTML = '';
    errEl.style.display = 'none';
    promptTimers.delete(errEl);
  }, PROMPT_TIMEOUT_MS);
  promptTimers.set(errEl, t);
}

// Show a "what's left to fill in" prompt in a step's error box (or the submit box
// for the final gate). Renders a short bullet list, then auto-clears after a
// timeout so it does not linger.
function showStepMissing(errEl, missing) {
  if (!errEl) return;
  const items = missing.map(m => `<li style="margin:.1rem 0">${m}</li>`).join('');
  errEl.innerHTML = `<strong>Please complete the following:</strong><ul style="margin:.4rem 0 0 1.1rem;padding:0">${items}</ul>`;
  errEl.style.display = 'block';
  clearPromptSoon(errEl);
}

// Show a plain-text error (e.g. the contact-info rule) and auto-clear it too.
function showStepError(errEl, text) {
  if (!errEl) return;
  errEl.textContent = text;
  errEl.style.display = 'block';
  clearPromptSoon(errEl);
}

function validateStep(step) {
  const errEl = document.getElementById(`step${step}Error`);
  if (errEl) { clearTimeout(promptTimers.get(errEl)); errEl.textContent = ''; errEl.style.display = 'none'; }

  const missing = missingFieldsForStep(step);
  // Contact-info is a content rule, not a missing field: report it on its own.
  if (step === 2 && !missing.length) {
    const title = document.getElementById('adTitle').value.trim();
    const desc = document.getElementById('adDescription').value.trim();
    const contactPattern = /(\d[\s\-().]{0,2}){7,}|@\w{3,}|\b(whatsapp|telegram|call me|my number)\b/i;
    if (contactPattern.test(title) || contactPattern.test(desc)) {
      showStepError(errEl, 'Remove contact information from the title/description.');
      return false;
    }
  }
  if (missing.length) { showStepMissing(errEl, missing); return false; }
  return true;
}

// ─── PRICE CALCULATOR ─────────────────────────────────────────────────────────
// The poster enters the price PER PERSON. The room total is shown for reference
// as per-person × occupancy (what a full room costs at that rate).
function calcPrice() {
  const perHead = parseFloat(document.getElementById('adOriginalPrice').value);
  const occ = parseInt(document.getElementById('adOccupancy').value);
  const preview = document.getElementById('pricePreview');
  if (!perHead || !occ) { preview.style.display = 'none'; return; }
  const roomTotal = perHead * occ;
  document.getElementById('prevPerHead').textContent = `GHS ${perHead.toLocaleString()} / year`;
  document.getElementById('prevRoomTotal').textContent = `Room total for ${occ}-in-1: GHS ${roomTotal.toLocaleString()}`;
  preview.style.display = 'block';
}

// ─── COVER PHOTO (entire building) ──────────────────────────────────────────────
function handleCoverSelect(files) {
  const file = files && files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return showToast('Please choose an image file', 'error');
  coverFile = file;
  renderCoverPreview();
}

function handleCoverDrop(e) {
  e.preventDefault();
  handleCoverSelect(e.dataTransfer.files);
}

function renderCoverPreview() {
  const zone = document.getElementById('coverDropzone');
  const holder = document.getElementById('coverPreview');
  if (!zone || !holder) return;
  if (!coverFile) {
    zone.classList.remove('filled');
    holder.innerHTML = `
      <i data-lucide="building" style="width:30px;height:30px;color:var(--text-muted)"></i>
      <p class="mt-2 mb-0" style="font-size:.85rem">Tap to upload a photo of the entire building</p>
      <p class="text-muted" style="font-size:.72rem;margin-top:.3rem">Only 1 photo · this becomes the cover</p>`;
  } else {
    zone.classList.add('filled');
    holder.innerHTML = `
      <div class="cover-preview-img">
        <img src="${URL.createObjectURL(coverFile)}" alt="Cover photo" />
        <span class="cover-tag"><i data-lucide="building" style="width:11px;height:11px"></i> Cover — entire building</span>
        <button type="button" class="cover-remove" onclick="event.stopPropagation();removeCover()" aria-label="Remove cover photo">✕</button>
      </div>`;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function removeCover() {
  coverFile = null;
  document.getElementById('coverInput').value = '';
  renderCoverPreview();
}

// ─── PHOTO HANDLING ───────────────────────────────────────────────────────────
function handlePhotoSelect(files) {
  selectedFiles = [...selectedFiles, ...Array.from(files)].slice(0, 9);
  renderPhotoPreview();
}

function handleDrop(e) {
  e.preventDefault();
  handlePhotoSelect(e.dataTransfer.files);
}

let dragIndex = null;
// A real HTML5 drag must never be misread as taps: after a drag the browser can
// fire pointerup/click on whichever tile the cursor ended up over. We set this
// flag on dragstart and clear it on the next genuine pointerdown, so drag and
// tap-tap stay two separate, predictable interactions.
let suppressTap = false;

function handleTileDragStart(e, i) {
  dragIndex = i;
  suppressTap = true;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
}

function handleTileDragEnd(e) {
  // Clear any leftover outline if the drag was cancelled (dropped outside)
  document.querySelectorAll('#photoPreview [data-index]').forEach(t => (t.style.outline = ''));
  dragIndex = null;
}

function handleTileDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.outline = '2px dashed var(--primary, #3b82f6)';
}

function handleTileDragLeave(e) {
  e.currentTarget.style.outline = '';
}

function handleTileDrop(e, i) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.style.outline = '';
  if (dragIndex === null || dragIndex === i) { dragIndex = null; return; }
  movePhoto(dragIndex, i);
}

// Reliable reordering: move a photo onto another position, used by BOTH
// drag-drop and the tap fallback (tap one photo, then tap another to place
// it there) — HTML5 drag doesn't work on touch screens, so tap keeps mobile usable.
function movePhoto(from, to) {
  if (from === null || to === null || from === to) return;
  if (from < 0 || to < 0 || from >= selectedFiles.length || to >= selectedFiles.length) return;
  const [moved] = selectedFiles.splice(from, 1);
  selectedFiles.splice(to, 0, moved);
  dragIndex = null;
  tapIndex = null;
  renderPhotoPreview();
}

// Tap-to-tap swaps the two photos (positions exchange, everything else stays).
// Drag-and-drop keeps its shift behaviour; only the tap path swaps.
function swapPhotos(a, b) {
  if (a === null || b === null || a === b) return;
  if (a < 0 || b < 0 || a >= selectedFiles.length || b >= selectedFiles.length) return;
  [selectedFiles[a], selectedFiles[b]] = [selectedFiles[b], selectedFiles[a]];
  dragIndex = null;
  tapIndex = null;
  renderPhotoPreview();
}
window.swapPhotos = swapPhotos; // exposed for QA

let tapIndex = null;
let tapStart = null;

function handleTilePointerDown(e, i) {
  // A fresh press cancels any drag-suppression from a previous drag.
  suppressTap = false;
  // Remember where the press started so a drag (finger/mouse moves away)
  // is never mistaken for a tap
  tapStart = { x: e.clientX, y: e.clientY, index: i };
}

function handleTileTap(e, i) {
  // The pointerup that follows a drag (fired on the drop target) is not a tap.
  if (suppressTap) return;
  // Ignore taps that are really drags, and taps that started on the remove button
  if (tapStart && tapStart.index === i &&
      Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 10) return;
  tapStart = null;
  if (e.target.closest('button')) return;

  const tiles = document.querySelectorAll('#photoPreview [data-index]');
  if (tapIndex === null) {
    tapIndex = i;
    tiles.forEach(t => t.classList.toggle('tap-selected', Number(t.dataset.index) === i));
    showToast('Now tap another photo to place this one there', 'info');
    return;
  }
  if (tapIndex !== i) swapPhotos(tapIndex, i);
  tapIndex = null;
  tiles.forEach(t => t.classList.remove('tap-selected'));
}

function renderPhotoPreview() {
  const preview = document.getElementById('photoPreview');
  const dz = document.getElementById('dropzone');
  preview.innerHTML = selectedFiles.map((f, i) => `
    <div data-index="${i}" draggable="true" title="Drag to reorder — or tap two photos to swap"
      ondragstart="handleTileDragStart(event, ${i})" ondragover="handleTileDragOver(event)" ondragleave="handleTileDragLeave(event)" ondrop="handleTileDrop(event, ${i})" ondragend="handleTileDragEnd(event)"
      onpointerdown="handleTilePointerDown(event, ${i})" onpointerup="handleTileTap(event, ${i})"
      style="position:relative;border-radius:var(--radius-sm);overflow:hidden;aspect-ratio:1;cursor:grab">
      <img src="${URL.createObjectURL(f)}" style="width:100%;height:100%;object-fit:cover;pointer-events:none" />
      <button onclick="event.stopPropagation();removePhoto(${i})" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:0.7rem;cursor:pointer">✕</button>
    </div>`).join('');
  // Once photos exist, shrink the upload box into a small tile at the end of the grid.
  if (selectedFiles.length > 0) {
    dz.classList.add('mini');
    preview.appendChild(dz);
  } else {
    dz.classList.remove('mini');
    document.getElementById('dropzoneSlot').appendChild(dz);
  }
}

function removePhoto(index) {
  selectedFiles.splice(index, 1);
  renderPhotoPreview();
}

// ─── MAP (LEAFLET) ────────────────────────────────────────────────────────────
function initPostMap() {
  if (postMap) { postMap.invalidateSize(); return; }

  const defaultLat = 5.6037; // Accra, Ghana
  const defaultLng = -0.1870;

  postMap = L.map('postMap').setView([defaultLat, defaultLng], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(postMap);

  // Restore existing pin if user navigated back
  const existingLat = document.getElementById('adLat').value;
  const existingLng = document.getElementById('adLng').value;
  if (existingLat && existingLng) {
    placePin(parseFloat(existingLat), parseFloat(existingLng), false);
    postMap.setView([parseFloat(existingLat), parseFloat(existingLng)], 16);
  }

  postMap.on('click', (e) => placePin(e.latlng.lat, e.latlng.lng, true));
}

function placePin(lat, lng, reverseGeocode) {
  if (postMarker) postMap.removeLayer(postMarker);

  postMarker = L.marker([lat, lng], { draggable: true }).addTo(postMap);
  // A permanent label instead of an auto-opening popup: the pin is a location
  // PICKER, so a bubble that pops up on every click/drag is just noise (the
  // "Pin set at …" text below already confirms the choice). Same label styling
  // as the map-search pins, for consistency across the site.
  postMarker.bindTooltip('Drag to fine-tune the pin', {
    permanent: true, direction: 'top', className: 'map-pin-label', offset: [0, -12]
  });

  postMarker.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    setLocationFields(pos.lat, pos.lng, true);
  });

  setLocationFields(lat, lng, reverseGeocode);
}

function setLocationFields(lat, lng, reverseGeocode) {
  document.getElementById('adLat').value = lat.toFixed(7);
  document.getElementById('adLng').value = lng.toFixed(7);
  document.getElementById('pinStatus').textContent = 'Pin set at ' + lat.toFixed(5) + ', ' + lng.toFixed(5);

  if (reverseGeocode) reverseGeocodePin(lat, lng);
}

async function reverseGeocodePin(lat, lng) {
  document.getElementById('pinStatus').textContent = 'Looking up address...';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, {
      headers: { 'Accept-Language': 'en' }
    });
    const data = await res.json();
    if (!data.address) return;

    const addr = data.address;
    // Build area name: suburb > neighbourhood > town > city > county
    const area = addr.suburb || addr.neighbourhood || addr.quarter || addr.town || addr.city || addr.county || addr.state || '';
    const city = addr.city || addr.town || addr.county || '';
    const areaFull = area && city && area !== city ? `${area}, ${city}` : area || city;

    // Full address
    const fullAddress = data.display_name || '';

    if (areaFull) document.getElementById('adLocationArea').value = areaFull;
    if (fullAddress) document.getElementById('adFullAddress').value = fullAddress;

    document.getElementById('pinStatus').textContent = areaFull || 'Location pinned';
  } catch {
    document.getElementById('pinStatus').textContent = 'Pin set at ' + parseFloat(document.getElementById('adLat').value).toFixed(5) + ', ' + parseFloat(document.getElementById('adLng').value).toFixed(5);
  }
}

function getMyLocation() {
  if (!navigator.geolocation) return showToast('Geolocation not supported', 'error');
  document.getElementById('pinStatus').textContent = 'Getting your location...';
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (!postMap) initPostMap();
    postMap.setView([lat, lng], 17);
    placePin(lat, lng, true);
  }, () => showToast('Could not get location. Please pin manually.', 'error'));
}

// ─── REVIEW SUMMARY ───────────────────────────────────────────────────────────
function buildReviewSummary() {
  const form = document.getElementById('postAdForm');
  const data = new FormData(form);
  const perHead = parseFloat(data.get('price_per_head') || 0);
  const occ = parseInt(data.get('occupancy_type') || 1);
  const roomTotal = (perHead * occ).toFixed(2);
  const area = data.get('location_area') || '—';
  const address = data.get('full_address') || '';
  document.getElementById('reviewSummary').innerHTML = `
    <div style="display:grid;gap:0.75rem;font-size:0.875rem">
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Title</span><span style="font-weight:600;max-width:60%;text-align:right">${data.get('title') || '—'}</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Occupancy</span><span>${occ}-in-1</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Price per person</span><span style="color:var(--primary);font-weight:700">GHS ${Number(perHead).toLocaleString()} / year</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Room total (${occ}-in-1)</span><span>GHS ${Number(roomTotal).toLocaleString()}</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Area</span><span>${area}</span></div>
      ${address ? `<div style="padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Address</span><br><span style="font-size:0.8rem">${address}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0"><span class="text-muted">Photos</span><span>${selectedFiles.length} uploaded</span></div>
    </div>`;
}

// ─── FORM SUBMIT ──────────────────────────────────────────────────────────────
document.getElementById('postAdForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const errEl = document.getElementById('submitError');
  errEl.textContent = '';

  // Final gate: re-run every step's validation so the form cannot be submitted
  // with anything missing (e.g. jumping straight to Review). We jump the wizard to
  // the FIRST incomplete step, where validateStep() has already written the
  // "what's left to fill in" prompt — so the message appears at that step.
  for (let s = 1; s <= TOTAL_STEPS - 1; s++) {
    if (!validateStep(s)) {
      currentStep = s;
      updateWizardUI();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Bring the prompt into view for tall steps.
      const stepErr = document.getElementById(`step${s}Error`);
      if (stepErr) stepErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  btn.disabled = true; btn.textContent = 'Submitting...';

  try {
    // Compress BEFORE building the request. The whole photo set travels in one
    // multipart body, and serverless platforms reject anything over ~4.5MB with
    // FUNCTION_PAYLOAD_TOO_LARGE — a handful of raw phone photos blows past that
    // instantly. (The server does convert WebP, but only after it has received
    // the body, so it cannot save an oversized request.)
    const raws = [coverFile, ...selectedFiles].filter(Boolean);
    const originals = raws.reduce((n, f) => n + f.size, 0);
    const compressed = await compressImages(raws, {}, (done, total) => {
      btn.textContent = `Optimising photo ${done}/${total}...`;
    });
    const total = compressed.reduce((n, r) => n + r.size, 0);
    // Tell the user what happened — silently shrinking their photos would be a
    // surprise, and the number is reassuring when the originals were huge.
    if (total < originals) {
      showToast(`Photos optimised: ${formatBytes(originals)} → ${formatBytes(total)}`, 'info', 3000);
    }

    btn.textContent = 'Submitting...';

    // CRITICAL: neutralise the file input before building the FormData.
    //
    // `new FormData(form)` walks the form and appends EVERY file input's files
    // under the input's own name. #fileInput is declared as
    //   <input type="file" id="fileInput" name="images" ... />
    // so the RAW, UNCOMPRESSED photos were being attached automatically — in
    // ADDITION to the compressed ones appended below. The request therefore
    // carried both sets, and 10 raw phone photos (~47MB) still blew past the
    // platform's ~4.5MB body limit with FUNCTION_PAYLOAD_TOO_LARGE.
    //
    // Clearing the input first means the automatic pass finds nothing and only
    // the compressed files below are sent. `selectedFiles`/`coverFile` are the
    // app's own copies of the user's picks and are unaffected, so the wizard can
    // still redraw its previews if the submit fails.
    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.value = '';

    const formData = new FormData(e.target);
    // Cover photo goes first — the backend marks the first image as primary/cover.
    // Order here must match `compressed`, which was built as [cover, ...photos].
    compressed.forEach(r => formData.append('images', r.file));
    await api.upload('/api/listings', formData);
    showToast('Room submitted for review!', 'success');
    setTimeout(() => location.href = '/dashboard', 1500);
  } catch (ex) {
    // A 413 can still happen (very many photos, or a proxy with a tighter cap),
    // and the raw platform error is meaningless to a user — explain the fix.
    const msg = /PAYLOAD_TOO_LARGE|413|too large/i.test(ex.message)
      ? 'Those photos are too large to upload together. Try removing a few, or upload smaller images.'
      : ex.message;
    errEl.textContent = msg;
    btn.disabled = false; btn.textContent = 'Submit for Review';
  }
});

checkAuth();
updateWizardUI();
