// ─── SIGNUP WIZARD ────────────────────────────────────────────────────────
// Seekers no longer pick a daily base: every seeker's base is fixed to UENR
// (Sunyani), set server-side at signup (see src/utils/seekerBase.js). So the
// seeker path is just two steps: role → details. The old base-location map
// step and its search/pin code were removed.
// Step 1: choose role → both paths: details
let suRole = null;

const suSteps = ['suStep1', 'seekerDetailsForm', 'signupForm'];

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
  } else if (id === 'seekerDetailsForm') {
    title.textContent = 'Your details';
    sub.textContent = 'Step 2 of 2 — almost done';
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

// Role selection (step 1). Seekers go straight to details — no base map step;
// their daily base is fixed to UENR server-side.
document.querySelectorAll('.su-role-card').forEach(card => {
  card.addEventListener('click', () => {
    suRole = card.dataset.role;
    suShow(suRole === 'seeker' ? 'seekerDetailsForm' : 'signupForm');
  });
});

function suPrev() { suShow('suStep1'); }


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
  btn.disabled = true; btn.classList.add('btn-loading');
  try {
    // NOTE: no base fields here — the seeker's daily base is fixed to UENR and
    // set by the server (src/utils/seekerBase.js). Anything sent is ignored.
    const body = {
      name,
      email,
      phone: phoneDigits,
      password,
      role: suRole
    };
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
    // Credential already used for this same role — point them at login instead.
    if (ex.accountExists || (ex.data && ex.data.accountExists)) {
      suErr(ex.message + ' You can log in with your existing password to use that account.');
    } else {
      suErr(ex.message);
    }
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
