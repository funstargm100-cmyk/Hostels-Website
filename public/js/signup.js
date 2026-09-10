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

// ─── PLACE SEARCH (popular chips + autocomplete via /api/geo) ─────────────────
let suSearchTimer = null;

async function suLoadPopular() {
  try {
    const { places } = await api.get('/api/geo/popular');
    const wrap = document.getElementById('suPopularChips');
    wrap.innerHTML = places.map((p, i) =>
      `<button type="button" class="su-chip" data-i="${i}">${p.emoji} ${p.label}</button>`).join('');
    wrap.querySelectorAll('.su-chip').forEach(btn => {
      btn.addEventListener('click', () => suSearchAndPin(places[+btn.dataset.i].query));
    });
  } catch { /* chips are optional — ignore */ }
}

async function suSearchAndPin(query) {
  const status = document.getElementById('suPinStatus');
  status.textContent = 'Searching "' + query + '"…';
  try {
    const { results } = await api.get('/api/geo/search?q=' + encodeURIComponent(query));
    if (!results.length) { status.textContent = 'No match found — try tapping the map.'; return; }
    const r = results[0];
    if (!suMap) suInitMap();
    suMap.setView([r.lat, r.lng], 16);
    suPlacePin(r.lat, r.lng, false);
    document.getElementById('suBaseLocation').value = r.display;
    document.getElementById('suPinStatus').textContent = r.name + (r.detail ? ' — ' + r.detail : '');
  } catch {
    status.textContent = 'Search failed — try tapping the map.';
  }
}

document.getElementById('suPlaceSearch').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  const box = document.getElementById('suSearchResults');
  clearTimeout(suSearchTimer);
  if (q.length < 3) { box.style.display = 'none'; box.innerHTML = ''; return; }
  suSearchTimer = setTimeout(async () => {
    box.innerHTML = '<div class="su-search-item muted">Searching…</div>';
    box.style.display = '';
    try {
      const { results } = await api.get('/api/geo/search?q=' + encodeURIComponent(q));
      if (!results.length) { box.innerHTML = '<div class="su-search-item muted">No matches</div>'; return; }
      box.innerHTML = results.map((r, i) => `
        <button type="button" class="su-search-item" data-i="${i}">
          <strong>${r.name}</strong>${r.detail ? `<span class="muted"> · ${r.detail}</span>` : ''}
        </button>`).join('');
      box.querySelectorAll('.su-search-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = results[+btn.dataset.i];
          if (!suMap) suInitMap();
          suMap.setView([r.lat, r.lng], 16);
          suPlacePin(r.lat, r.lng, false);
          document.getElementById('suBaseLocation').value = r.display;
          document.getElementById('suPinStatus').textContent = r.name + (r.detail ? ' — ' + r.detail : '');
          box.style.display = 'none';
          e.target.value = r.name;
        });
      });
    } catch {
      box.innerHTML = '<div class="su-search-item muted">Search unavailable — pin the map instead</div>';
    }
  }, 350); // debounce
});

document.addEventListener('click', (e) => {
  const box = document.getElementById('suSearchResults');
  if (box && !e.target.closest('.su-search-wrap')) box.style.display = 'none';
});

suLoadPopular();

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
  const name = fields.name();
  const email = fields.email();
  const phone = fields.phone();
  const password = fields.password();
  if (!name) { suErr('Please enter your full name.'); return; }
  if (!email) { suErr('Please enter your email address.'); return; }
  if (!phone) { suErr('Please enter your phone number.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { suErr('Please enter a valid email address.'); return; }
  const phoneDigits = phone.replace(/[\s()\-]/g, '');
  if (!/^\+?[0-9]{9,15}$/.test(phoneDigits)) { suErr('Please enter a valid phone number (9–15 digits).'); return; }
  if (!password) { suErr('Please choose a password.'); return; }
  if (password.length < 6) { suErr('Password must be at least 6 characters.'); return; }
  if (suRole === 'seeker' && !document.getElementById('suBaseLat').value) {
    suErr('Please pin your school or workplace on the map first.');
    return;
  }
  btn.disabled = true; btn.classList.add('btn-loading');
  try {
    const body = {
      name,
      email,
      phone: phoneDigits,
      password,
      role: suRole
    };
    if (suRole === 'seeker') {
      body.base_location = document.getElementById('suBaseLocation').value || 'Pinned location';
      body.base_lat = document.getElementById('suBaseLat').value;
      body.base_lng = document.getElementById('suBaseLng').value;
    }
    const res = await api.post('/api/auth/signup', body);
    // Account created — send the user straight to the verification step.
    const emailQ = email || '';
    showToast(
      res.emailSent === false
        ? 'Account created, but the verification email failed — use "Resend code" next.'
        : 'Account created! Enter the verification code we emailed you.',
      res.emailSent === false ? 'error' : 'success'
    );
    setTimeout(() => {
      location.href = '/login?verify=1&uuid=' + encodeURIComponent(res.uuid) +
        (emailQ ? '&email=' + encodeURIComponent(emailQ) : '') +
        '&t=' + Date.now();
    }, 1200);
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
