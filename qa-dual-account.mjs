// End-to-end check for "one credential, both a seeker and an agent account".
// Runs against a live server on http://localhost:3000 (start it first).
const BASE = process.env.BASE || 'http://localhost:3000';
const stamp = Date.now();
const email = `dual_${stamp}@example.com`;
const phone = '055' + String(stamp).slice(-7);
const password = 'TestPass123';

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = {};
  try { data = await res.json(); } catch { }
  return { status: res.status, data };
}

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? ' :: ' + extra : ''));
};

(async () => {
  // 1. Create the SEEKER account.
  const r1 = await post('/api/auth/signup', {
    name: 'Dual Seeker', email, phone, password, role: 'seeker',
    base_location: 'Test School', base_lat: 5.6037, base_lng: -0.1870
  });
  check('signup seeker created', r1.status === 200 && r1.data.uuid, JSON.stringify(r1.data).slice(0, 160));
  const seekerUuid = r1.data.uuid;

  // 2. Create the AGENT account with the SAME email + phone.
  const r2 = await post('/api/auth/signup', {
    name: 'Dual Agent', email, phone, password, role: 'owner'
  });
  check('signup agent (same credential) created', r2.status === 200 && r2.data.uuid, JSON.stringify(r2.data).slice(0, 160));
  const agentUuid = r2.data.uuid;

  // 3. Creating the SAME role again must be rejected.
  const r3 = await post('/api/auth/signup', {
    name: 'Dual Seeker 2', email, phone, password, role: 'seeker'
  });
  check('duplicate same-role signup rejected (409)', r3.status === 409 && r3.data.accountExists === true, JSON.stringify(r3.data).slice(0, 160));

  // Verify both accounts directly in the DB (bypassing OTP email).
  require('dotenv').config();
  const db = require('./src/utils/db.js');
  await db.query('UPDATE users SET is_verified=TRUE WHERE uuid IN ($1,$2)', [seekerUuid, agentUuid]);
  const grp = await db.query('SELECT uuid, role, account_group FROM users WHERE uuid IN ($1,$2)', [seekerUuid, agentUuid]);
  const sameGroup = grp.rows.length === 2 && grp.rows[0].account_group && grp.rows[0].account_group === grp.rows[1].account_group;
  check('both accounts share account_group', sameGroup, JSON.stringify(grp.rows));

  // 4. Login with the shared credential must ask which role.
  const r4 = await post('/api/auth/login', { identifier: email, password });
  check('login returns chooseRole', r4.status === 200 && r4.data.chooseRole === true, JSON.stringify(r4.data).slice(0, 200));
  const roles = (r4.data.roles || []).sort().join(',');
  check('chooseRole lists seeker + owner', roles === 'owner,seeker', roles);

  // 5. select-account issues a token for the requested role.
  const r5 = await post('/api/auth/select-account', { identifier: email, password, role: 'owner' });
  check('select-account owner -> token', r5.status === 200 && r5.data.token && r5.data.user.role === 'owner', JSON.stringify(r5.data).slice(0, 160));

  const r6 = await post('/api/auth/select-account', { identifier: phone, password, role: 'seeker' });
  check('select-account seeker via phone -> token', r6.status === 200 && r6.data.token && r6.data.user.role === 'seeker', JSON.stringify(r6.data).slice(0, 160));

  // 6. Wrong role / wrong password must be rejected generically.
  const r7 = await post('/api/auth/select-account', { identifier: email, password, role: 'agent' });
  check('select-account for non-existent role rejected', r7.status === 401, JSON.stringify(r7.data).slice(0, 120));

  // Cleanup.
  await db.query('DELETE FROM users WHERE uuid IN ($1,$2)', [seekerUuid, agentUuid]);
  console.log('cleaned up test accounts');

  const failed = results.filter(r => !r.ok);
  console.log('\n' + (failed.length ? failed.length + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
