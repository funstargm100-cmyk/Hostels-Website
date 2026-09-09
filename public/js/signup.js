// ─── SIGNUP WIZARD ────────────────────────────────────────────────────────────
// Step 1: choose role → seeker path: map (base location) → details
//                        → owner path: details
let suRole = null;
let suMap = null;
let suMarker = null;

const suSteps = ['suStep1', 'suSeekerMap', 'seekerDetailsForm', 'signupForm'];

function suShow(id) {
  suSteps.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? '' : 'none';
  });
  document.getElementById('signupError').style.display = 'none';
  const title = document.getElementById('suStepTitle');
  const sub = document.getElementById('suStepSub');
  if (id === 'suStep1') {
    title.textContent = 'Create your account';
    sub.textContent = 'First — what brings you to Roomy?';
  } else if (id === 'suSeekerMap') {
    title.textContent = 'Your daily base';
    sub.textContent = 'Step 2 of 3 — pin your school or workplace';
  } else if (id === 'seekerDetailsForm') {
    title.textContent = 'Your details';
    sub.textContent = 'Step 3 of 3 — almost done';
  } else {
    title.textContent = 'Your details';
    sub.textContent = 'Tell us a bit about yourself';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function suErr(msg) {
  const el = document.getElementById('signupError');
  el.textContent = msg;
  el.style.display = 'block';
}

// Role selection (step 1)
document.querySelectorAll('.su-role-card').forEach(card => {
  card.addEventListener('click', () => {
    suRole = card.dataset.role;
    if (suRole === 'seeker') {
      suShow('suSeekerMap');
      setTimeout(suInitMap, 60); // let the container become visible first
    } else {
      suShow('signupForm');
    }
  });
});

function suPrev() {
  if (suRole === 'seeker' && document.getElementById('suSeekerMap').style.display !== 'none') suShow('suStep1');
  else if (suRole === 'seeker') suShow('suSeekerMap');
  else suShow('suStep1');
}

// ─── MAP (LEAFLET) ────────────────────────────────────────────────────────────
function suInitMap() {
  if (suMap) { suMap.invalidateSize(); return; }
  const defaultLat = 5.6037; // Accra, Ghana
  const defaultLng = -0.1870;

  suMap = L.map('suMap').setView([defaultLat, defaultLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(suMap);

  const lat = document.getElementById('suBaseLat').value;
  const lng = document.getElementById('suBaseLng').value;
  if (lat && lng) {
    suPlacePin(parseFloat(lat), parseFloat(lng), false);
    suMap.setView([parseFloat(lat), parseFloat(lng)], 16);
  }

  suMap.on('click', (e) => suPlacePin(e.latlng.lat, e.latlng.lng, true));
}

function suPlacePin(lat, lng, reverseGeocode) {
  if (suMarker) suMap.removeLayer(suMarker);
  suMarker = L.marker([lat, lng], { draggable: true }).addTo(suMap);
  suMarker.bindPopup('My base').openPopup();
  suMarker.on('dragend', (e) => {
    const pos = e.target.getLatLng();
    suSetLocation(pos.lat, pos.lng, true);
  });
  suSetLocation(lat, lng, reverseGeocode);
}

function suSetLocation(lat, lng, reverseGeocode) {
  document.getElementById('suBaseLat').value = lat.toFixed(7);
  document.getElementById('suBaseLng').value = lng.toFixed(7);
  const status = document.getElementById('suPinStatus');
  status.textContent = 'Pin set at ' + lat.toFixed(5) + ', ' + lng.toFixed(5);
  if (reverseGeocode) suReverseGeocode(lat, lng);
}

async function suReverseGeocode(lat, lng) {
  const status = document.getElementById('suPinStatus');
  status.textContent = 'Looking up address...';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, {
      headers: { 'Accept-Language': 'en' }
    });
    const data = await res.json();
    if (data.display_name) {
      document.getElementById('suBaseLocation').value = data.display_name;
      status.textContent = data.display_name.split(',').slice(0, 3).join(', ');
    }
  } catch {
    // keep coords-only status
  }
}

function suGetMyLocation() {
  if (!navigator.geolocation) return showToast('Geolocation not supported', 'error');
  document.getElementById('suPinStatus').textContent = 'Getting your location...';
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (!suMap) suInitMap();
    suMap.setView([lat, lng], 17);
    suPlacePin(lat, lng, true);
  }, () => showToast('Could not get location. Please pin manually.', 'error'));
}

// Continue from map step → details
document.getElementById('suMapNextBtn').addEventListener('click', () => {
  if (!document.getElementById('suBaseLat').value) {
    suErr('Please pin your school or workplace on the map first.');
    return;
  }
  suShow('seekerDetailsForm');
});

// ─── SUBMIT (both paths) ──────────────────────────────────────────────────────
async function suSubmit(btnId, fields) {
  const btn = document.getElementById(btnId);
  const email = fields.email();
  const phone = fields.phone();
  if (!email && !phone) { suErr('Provide an email or phone number.'); return; }
  btn.disabled = true; btn.classList.add('btn-loading');
  try {
    const body = {
      name: fields.name(),
      email: email || undefined,
      phone: phone || undefined,
      password: fields.password(),
      role: suRole
    };
    if (suRole === 'seeker') {
      body.base_location = document.getElementById('suBaseLocation').value || 'Pinned location';
      body.base_lat = document.getElementById('suBaseLat').value;
      body.base_lng = document.getElementById('suBaseLng').value;
    }
    await api.post('/api/auth/signup', body);
    // Account created — the API sends an OTP for verification, so go log in.
    showToast('Account created! Check your email for the verification code.', 'success');
    setTimeout(() => { location.href = '/login'; }, 1200);
  } catch (ex) {
    suErr(ex.message);
    btn.disabled = false; btn.classList.remove('btn-loading');
  }
}

document.getElementById('seekerDetailsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  suSubmit('seekerSubmitBtn', {
    name: () => document.getElementById('suSeekerName').value.trim(),
    email: () => document.getElementById('suSeekerEmail').value.trim(),
    phone: () => document.getElementById('suSeekerPhone').value.trim(),
    password: () => document.getElementById('suSeekerPassword').value
  });
});

document.getElementById('signupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  suSubmit('signupSubmitBtn', {
    name: () => document.getElementById('suName').value.trim(),
    email: () => document.getElementById('suEmail').value.trim(),
    phone: () => document.getElementById('suPhone').value.trim(),
    password: () => document.getElementById('suPassword').value
  });
});
