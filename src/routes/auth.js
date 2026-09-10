const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { sendEmail, templates } = require('../utils/mailer');

const SECRET = process.env.SESSION_SECRET || 'hostel_secret';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{9,15}$/; // digits only after optional +, 9–15 digits (E.164-ish)

const normalizePhone = (p) => (p || '').replace(/[\s()\-]/g, '');
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const signToken = (user) => jwt.sign(
  { id: user.id, uuid: user.uuid, name: user.name, role: user.role },
  SECRET,
  { expiresIn: '7d' }
);

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { name, email, phone, password, role, base_location, base_lat, base_lng } = req.body;
  if (!name || !email || !phone || !password)
    return res.status(400).json({ error: 'All fields are required: name, email, phone, password' });
  if (!name.trim())
    return res.status(400).json({ error: 'Please enter your full name' });
  if (!['seeker', 'owner'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });

  // Contact validation — if a contact is provided it must be a REAL email or phone,
  // not just any text (never allow garbage input to bypass).
  if (email && !EMAIL_RE.test(email.trim()))
    return res.status(400).json({ error: 'Please enter a valid email address' });
  const normPhone = normalizePhone(phone);
  if (phone && !PHONE_RE.test(normPhone))
    return res.status(400).json({ error: 'Please enter a valid phone number (9–15 digits)' });
  if (!email)
    return res.status(400).json({ error: 'A valid email address is required' });
  if (!normPhone)
    return res.status(400).json({ error: 'A valid phone number is required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (name.trim().length < 2)
    return res.status(400).json({ error: 'Please enter your full name' });
  // Seekers should provide their workplace/school base (lat/lng or at least a text)
  if (role === 'seeker' && !base_location)
    return res.status(400).json({ error: 'Please pin your workplace or school location' });

  try {
    const existing = await db.query('SELECT id FROM users WHERE email=$1 OR phone=$2', [email || null, normPhone || null]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'Account already exists with this email or phone' });

    const hash = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const lat = base_lat !== undefined && base_lat !== null && base_lat !== '' ? parseFloat(base_lat) : null;
    const lng = base_lng !== undefined && base_lng !== null && base_lng !== '' ? parseFloat(base_lng) : null;

    const result = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, role, otp_code, otp_expires_at, base_location, base_lat, base_lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING uuid`,
      [name.trim(), email ? email.trim().toLowerCase() : null, normPhone || null, hash, role, otp, otpExpiry,
       role === 'seeker' ? base_location : null,
       role === 'seeker' && Number.isFinite(lat) ? lat : null,
       role === 'seeker' && Number.isFinite(lng) ? lng : null]
    );
    const uuid = result.rows[0].uuid;

    // Await the send so serverless (Vercel) doesn't kill it after the response.
    let emailSent = true;
    if (email) {
      emailSent = await sendEmail(email, 'Verify your account', templates.otp(otp));
      if (!emailSent)
        console.error('Signup OTP email failed for', email, '— user can use resend on the login page.');
    }
    res.json({
      message: emailSent ? 'Account created. Check your email for OTP.' : 'Account created, but the verification email could not be sent. Use "Resend code" on the verification page.',
      uuid,
      email: email || null,
      phone: phone || null,
      emailSent
    });
  } catch (err) {
    console.error('SIGNUP ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/resend-otp
router.post('/resend-otp', async (req, res) => {
  const { uuid } = req.body;
  if (!uuid) return res.status(400).json({ error: 'Account id required' });
  try {
    const result = await db.query('SELECT * FROM users WHERE uuid=$1', [uuid]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_verified) return res.status(400).json({ error: 'Account is already verified. Try logging in.' });
    if (!user.email) return res.status(400).json({ error: 'This account has no email to send a code to' });

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await db.query('UPDATE users SET otp_code=$1, otp_expires_at=$2 WHERE id=$3', [otp, otpExpiry, user.id]);

    const sent = await sendEmail(user.email, 'Your verification code', templates.otp(otp));
    if (!sent)
      return res.status(500).json({ error: 'Could not send the verification email right now. Please try again later or contact support.' });
    res.json({ message: 'A new verification code was sent to your email.' });
  } catch (err) {
    console.error('RESEND OTP ERROR:', err.message);
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
  const { identifier, email, phone, password } = req.body;
  const id = identifier || email || phone;
  if (!id || !password) return res.status(400).json({ error: 'Email/phone and password required' });
  try {
    const result = await db.query('SELECT * FROM users WHERE email=$1 OR phone=$1', [id]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_suspended) return res.status(403).json({ error: 'Account suspended. Contact support.' });
    if (!user.is_verified)
      return res.status(403).json({
        error: 'Please verify your account first. We sent a code to your email.',
        needVerification: true,
        uuid: user.uuid,
        email: user.email || null
      });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    const userData = { id: user.id, uuid: user.uuid, name: user.name, role: user.role };
    res.json({ message: 'Login successful', token, user: userData });
  } catch (err) {
    console.error('LOGIN ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  // JWT is stateless — client just deletes the token
  res.json({ message: 'Logged out' });
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
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = jwt.verify(token, SECRET);
    res.json({ user });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
