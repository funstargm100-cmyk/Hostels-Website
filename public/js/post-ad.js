let currentStep = 1;
const TOTAL_STEPS = 6;
let selectedFiles = [];

// ─── AUTH GATE ────────────────────────────────────────────────────────────────
async function checkAuth() {
  const user = await initNavAuth();
  if (!user) { location.href = '/login?redirect=/post-ad'; return; }
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
    // Client-side contact info check
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
    if (!document.getElementById('adLocationArea').value.trim()) { if (errEl) errEl.textContent = 'Location area is required.'; return false; }
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

// ─── LOCATION ─────────────────────────────────────────────────────────────────
function getMyLocation() {
  navigator.geolocation?.getCurrentPosition(pos => {
    document.getElementById('adLat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('adLng').value = pos.coords.longitude.toFixed(6);
    showToast('Location captured', 'success');
  }, () => showToast('Could not get location', 'error'));
}

// ─── REVIEW SUMMARY ───────────────────────────────────────────────────────────
function buildReviewSummary() {
  const form = document.getElementById('postAdForm');
  const data = new FormData(form);
  const price = parseFloat(data.get('original_price') || 0);
  const occ = parseInt(data.get('occupancy_type') || 1);
  const listed = (price * 1.10).toFixed(2);
  document.getElementById('reviewSummary').innerHTML = `
    <div style="display:grid;gap:0.75rem;font-size:0.875rem">
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Title</span><span style="font-weight:600;max-width:60%;text-align:right">${data.get('title') || '—'}</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Occupancy</span><span>${occ}-in-1</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Listed Price</span><span style="color:var(--primary);font-weight:700">GHS ${listed}</span></div>
      <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)"><span class="text-muted">Location</span><span>${data.get('location_area') || '—'}</span></div>
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
    const res = await api.upload('/api/listings', formData);
    showToast('Listing submitted for review!', 'success');
    setTimeout(() => location.href = '/dashboard', 1500);
  } catch (ex) {
    errEl.textContent = ex.message;
    btn.disabled = false; btn.textContent = '🚀 Submit for Review';
  }
});

checkAuth();
updateWizardUI();
