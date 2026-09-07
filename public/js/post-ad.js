let currentStep = 1;
const TOTAL_STEPS = 6;
let selectedFiles = [];
let postMap = null;
let postMarker = null;

// ─── AUTH GATE ────────────────────────────────────────────────────────────────
async function checkAuth() {
  const user = await initNavAuth();
  if (!user) { location.href = '/login?redirect=/post-ad'; return; }
  if (user.role === 'seeker') {
    document.getElementById('wizardContainer').innerHTML = '<div class="card" style="padding:2rem;text-align:center"><div style="font-size:3rem;margin-bottom:1rem">🚫</div><h2>Owners Only</h2><p class="text-muted mt-1 mb-3">Only owners and agents can post listings. Sign up with an owner account to list a room.</p><a href="/signup" class="btn btn-primary btn-lg">Create Owner Account</a></div>';
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

function validateStep(step) {
  const errEl = document.getElementById(`step${step}Error`);
  if (errEl) errEl.textContent = '';

  if (step === 1) {
    if (!selectedFiles.length) { if (errEl) errEl.textContent = 'Please upload at least one photo.'; return false; }
  }
  if (step === 2) {
    const title = document.getElementById('adTitle').value.trim();
    const desc = document.getElementById('adDescription').value.trim();
    if (!title) { if (errEl) errEl.textContent = 'Title is required.'; return false; }
    const contactPattern = /(\d[\s\-().]{0,2}){7,}|@\w{3,}|\b(whatsapp|telegram|call me|my number)\b/i;
    if (contactPattern.test(title) || contactPattern.test(desc)) {
      if (errEl) errEl.textContent = 'Remove contact information from title/description.';
      return false;
    }
  }
  if (step === 3) {
    if (!document.getElementById('adOccupancy').value) { if (errEl) errEl.textContent = 'Select occupancy type.'; return false; }
    if (!document.getElementById('adOriginalPrice').value) { if (errEl) errEl.textContent = 'Enter a price.'; return false; }
  }
  if (step === 5) {
    if (!document.getElementById('adLat').value || !document.getElementById('adLng').value) {
      if (errEl) errEl.textContent = 'Please drop a pin on the map to set the location.';
      return false;
    }
    if (!document.getElementById('adLocationArea').value.trim()) {
      if (errEl) errEl.textContent = 'Location area is required.';
      return false;
    }
  }
  return true;
}

// ─── PRICE CALCULATOR ─────────────────────────────────────────────────────────
function calcPrice() {
  const price = parseFloat(document.getElementById('adOriginalPrice').value);
  const occ = parseInt(document.getElementById('adOccupancy').value);
  const preview = document.getElementById('pricePreview');
  if (!price || !occ) { preview.style.display = 'none'; return; }
  const fee = price * 0.10;
  const listed = price + fee;
  const perHead = listed / occ;
  document.getElementById('prevOriginal').textContent = `GHS ${price.toLocaleString()}`;
  document.getElementById('prevFee').textContent = `GHS ${fee.toFixed(2)}`;
  document.getElementById('prevListed').textContent = `GHS ${listed.toFixed(2)}`;
  document.getElementById('prevPerHead').textContent = occ > 1 ? `Per person: GHS ${perHead.toFixed(2)}` : '';
  preview.style.display = 'block';
}

// ─── PHOTO HANDLING ───────────────────────────────────────────────────────────
function handlePhotoSelect(files) {
  selectedFiles = [...selectedFiles, ...Array.from(files)].slice(0, 10);
  renderPhotoPreview();
}

function handleDrop(e) {
  e.preventDefault();
  handlePhotoSelect(e.dataTransfer.files);
}

function renderPhotoPreview() {
  const preview = document.getElementById('photoPreview');
  preview.innerHTML = selectedFiles.map((f, i) => `
    <div style="position:relative;border-radius:var(--radius-sm);overflow:hidden;aspect-ratio:1">
      <img src="${URL.createObjectURL(f)}" style="width:100%;height:100%;object-fit:cover" />
      ${i === 0 ? '<span style="position:absolute;bottom:0;left:0;right:0;background:rgba(255,107,107,0.85);color:#fff;font-size:0.65rem;text-align:center;padding:2px">Cover</span>' : ''}
      <button onclick="removePhoto(${i})" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:0.7rem;cursor:pointer">✕</button>
    </div>`).join('');
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
  postMarker.bindPopup('📍 Hostel location').openPopup();

  postMarker.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    setLocationFields(pos.lat, pos.lng, true);
  });

  setLocationFields(lat, lng, reverseGeocode);
}

function setLocationFields(lat, lng, reverseGeocode) {
  document.getElementById('adLat').value = lat.toFixed(7);
  document.getElementById('adLng').value = lng.toFixed(7);
  document.getElementById('pinStatus').textContent = `📍 Pin set at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  if (reverseGeocode) reverseGeocodePin(lat, lng);
}

async function reverseGeocodePin(lat, lng) {
  document.getElementById('pinStatus').textContent = '🔄 Looking up address...';
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

    document.getElementById('pinStatus').textContent = `📍 ${areaFull || 'Location pinned'}`;
  } catch {
    document.getElementById('pinStatus').textContent = `📍 Pin set at ${parseFloat(document.getElementById('adLat').value).toFixed(5)}, ${parseFloat(document.getElementById('adLng').value).toFixed(5)}`;
  }
}

function getMyLocation() {
  if (!navigator.geolocation) return showToast('Geolocation not supported', 'error');
  document.getElementById('pinStatus').textContent = '🔄 Getting your location...';
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
  const price = parseFloat(data.get('original_price') || 0);
  const occ = parseInt(data.get('occupancy_type') || 1);
  const listed = (price * 1.10).toFixed(2);
  const area = data.get('location_area') || '—';
  const address = data.get('full_address') || '';
  document.getElementById('reviewSummary').innerHTML = `
    <div style="display:grid;gap:0.75rem;font-size:0.875rem">
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Title</span><span style="font-weight:600;max-width:60%;text-align:right">${data.get('title') || '—'}</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Occupancy</span><span>${occ}-in-1</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Listed Price</span><span style="color:var(--primary);font-weight:700">GHS ${listed}</span></div>
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
  btn.disabled = true; btn.textContent = 'Submitting...';

  try {
    const formData = new FormData(e.target);
    selectedFiles.forEach(f => formData.append('images', f));
    await api.upload('/api/listings', formData);
    showToast('Listing submitted for review!', 'success');
    setTimeout(() => location.href = '/dashboard', 1500);
  } catch (ex) {
    errEl.textContent = ex.message;
    btn.disabled = false; btn.textContent = '🚀 Submit for Review';
  }
});

checkAuth();
updateWizardUI();
