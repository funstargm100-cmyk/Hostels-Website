require('dotenv').config();
const db = require('./src/utils/db.js');
const bcrypt = require('bcryptjs');
const { v4 } = require('uuid');
const BASE = 'http://localhost:3000';
(async () => {
  let uid = null;
  try {
    const hash = await bcrypt.hash('TestPass123', 10);
    const e = 'probe2_' + Date.now() + '@example.com';
    const u = await db.query(
      "INSERT INTO users (name,email,phone,password_hash,role,is_verified,account_group) VALUES ('Probe Two',$1,$2,$3,'seeker',TRUE,$4) RETURNING id",
      [e, '098' + String(Date.now()).slice(-7), hash, v4()]);
    uid = u.rows[0].id;
    const login = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: e, password: 'TestPass123' })
    });
    const ld = await login.json();
    console.log('login status', login.status, 'token?', !!ld.token);
    const tok = ld.token;
    const prof = await fetch(BASE + '/api/user/profile', { headers: { Authorization: 'Bearer ' + tok });
    const pd = await prof.json();
    console.log('GET /profile status', prof.status);
    console.log('has_active_request field:', 'has_active_request' in pd, '=', pd.has_active_request);
    console.log('user.email present:', !!(pd.user && pd.user.email));
  } catch (err) { console.error('ERR', err.message); }
  if (uid) await db.query('DELETE FROM users WHERE id=$1', [uid]).catch(() => { });
  process.exit(0);
})();
