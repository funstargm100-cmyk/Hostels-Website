const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { sendEmail, templates } = require('../utils/mailer');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !password || (!email && !phone))
    return res.status(400).json({ error: 'Name, password, and email or phone required' });
  if (!['seeker', 'owner'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });

  try {
    const existing = await db.query('SELECT id FROM users WHERE email=$1 OR phone=$2', [email || null, phone || null]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'Account already exists with this email or phone' });

    const hash = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const result = await db.query(
      'INSERT INTO users (name, email, phone, password_hash, role, otp_code, otp_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING uuid',
      [name, email || null, phone || null, hash, role, otp, otpExpiry]
    );
    const uuid = result.rows[0].uuid;

    if (email) sendEmail(email, 'Verify your account', templates.otp(otp)).catch(console.error);
    res.json({ message: 'Account created. Check your email/phone for OTP.', uuid });
  } catch (err) {
    console.error('SIGNUP ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { uuid, otp } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE uuid=$1', [uuid]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.otp_code !== otp || new Date() > new Date(user.otp_expires_at))
      return res.status(400).json({ error: 'Invalid or expired OTP' });

    await db.query('UPDATE users SET is_verified=TRUE, otp_code=NULL, otp_expires_at=NULL WHERE id=$1', [user.id]);
    res.json({ message: 'Account verified successfully' });
  } catch (err) {
    console.error('OTP ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE email=$1 OR phone=$1', [identifier]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_suspended) return res.status(403).json({ error: 'Account suspended. Contact support.' });
    if (!user.is_verified) return res.status(403).json({ error: 'Please verify your account first' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.user = { id: user.id, uuid: user.uuid, name: user.name, role: user.role, is_kyc_verified: user.is_kyc_verified };
    res.json({ message: 'Login successful', user: req.session.user });
  } catch (err) {
    console.error('LOGIN ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (!result.rows.length) return res.json({ message: 'If that email exists, a reset link was sent.' });

    const token = uuidv4();
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await db.query('UPDATE users SET reset_token=$1, reset_expires_at=$2 WHERE email=$3', [token, expiry, email]);

    const link = `${process.env.BASE_URL}/reset-password?token=${token}`;
    sendEmail(email, 'Reset your password', `<p>Click <a href="${link}">here</a> to reset your password. Expires in 1 hour.</p>`).catch(console.error);
    res.json({ message: 'If that email exists, a reset link was sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE reset_token=$1 AND reset_expires_at > NOW()', [token]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const hash = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password_hash=$1, reset_token=NULL, reset_expires_at=NULL WHERE id=$2', [hash, user.id]);
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user });
});

module.exports = router;
