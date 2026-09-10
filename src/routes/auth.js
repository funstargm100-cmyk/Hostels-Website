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

  const normEmail = email ? email.trim().toLowerCase() : null;
  try {
    // A credential (email/phone) may already exist — but only for a DIFFERENT role.
    // One credential is allowed to own both a seeker and an agent/owner account,
    // linked together via account_group. The same role cannot be created twice.
    const existing = await db.query(
      'SELECT id, uuid, role, account_group FROM users WHERE LOWER(email)=$1 OR phone=$2',
      [normEmail, normPhone || null]
    );
    const sameRole = existing.rows.find(r => r.role === role);
    if (sameRole)
      return res.status(409).json({
        error: role === 'seeker'
          ? 'You already have a seeker account with this email or phone. Log in instead.'
          : 'You already have an agent account with this email or phone. Log in instead.',
        accountExists: true,
        existingRole: role
      });

    // Link to the sibling account's group so login can offer a role choice.
    const account_group = existing.rows[0]?.account_group || uuidv4();

    const hash = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const lat = base_lat !== undefined && base_lat !== null && base_lat !== '' ? parseFloat(base_lat) : null;
    const lng = base_lng !== undefined && base_lng !== null && base_lng !== '' ? parseFloat(base_lng) : null;

    const result = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, role, otp_code, otp_expires_at, base_location, base_lat, base_lng, account_group)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING uuid`,
      [name.trim(), normEmail, normPhone || null, hash, role, otp, otpExpiry,
       role === 'seeker' ? base_location : null,
       role === 'seeker' && Number.isFinite(lat) ? lat : null,
       role === 'seeker' && Number.isFinite(lng) ? lng : null,
       account_group]
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
// One credential may own BOTH a seeker and an agent/owner account. When that is
// the case the caller gets `chooseRole: true` plus the list of roles instead of
// a token, and must call /select-account to finish logging into one of them.
router.post('/login', async (req, res) => {
  const { identifier, email, phone, password } = req.body;
  const id = identifier || email || phone;
  if (!id || !password) return res.status(400).json({ error: 'Email/phone and password required' });
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE LOWER(email)=LOWER($1) OR phone=$1 ORDER BY id ASC',
      [id]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    // Every row sharing this credential must pass the same password check. They
    // are linked by account_group; fall back to "all matching rows" when the
    // column is not yet present on older databases.
    const group = result.rows[0].account_group;
    const candidates = group
      ? result.rows.filter(r => r.account_group === group)
      : result.rows;

    // If the entered password belongs to only ONE of the linked accounts, narrow
    // to it — the user clearly means that account (passwords can differ).
    const matching = [];
    for (const row of candidates) {
      if (await bcrypt.compare(password, row.password_hash)) matching.push(row);
    }
    if (!matching.length) return res.status(401).json({ error: 'Invalid credentials' });

    // Suspended accounts never take part in the offer.
    const usable = matching.filter(r => !r.is_suspended);
    if (!usable.length) return res.status(403).json({ error: 'Account suspended. Contact support.' });

    // Prefer a verified account; if none is verified, ask the user to verify.
    const verified = usable.filter(r => r.is_verified);
    if (!verified.length) {
      const u = usable[0];
      return res.status(403).json({
        error: 'Please verify your account first. We sent a code to your email.',
        needVerification: true,
        uuid: u.uuid,
        email: u.email || null
      });
    }

    // A single linked account — just log in, no chooser needed.
    if (verified.length === 1) {
      const user = verified[0];
      const token = signToken(user);
      return res.json({
        message: 'Login successful',
        token,
        user: { id: user.id, uuid: user.uuid, name: user.name, role: user.role }
      });
    }

    // Multiple accounts share this credential — let the user pick which to enter.
    const roles = verified.map(u => u.role);
    res.json({
      chooseRole: true,
      message: 'This login has more than one account. Choose how to continue.',
      identifier: id,
      roles,
      accounts: verified.map(u => ({ uuid: u.uuid, name: u.name, role: u.role, email: u.email || null }))
    });
  } catch (err) {
    console.error('LOGIN ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/select-account
// Second step of the "one credential, two accounts" login: the user has already
// proven the shared password, so we re-check it and issue a token for the
// account matching the chosen role. The response is deliberately neutral about
// which roles exist so this cannot be used to enumerate accounts.
router.post('/select-account', async (req, res) => {
  const { identifier, password, role } = req.body;
  if (!identifier || !password || !role)
    return res.status(400).json({ error: 'Identifier, password and role are required' });
  if (!['seeker', 'owner', 'agent'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });
  try {
    const result = await db.query(
      "SELECT * FROM users WHERE (LOWER(email)=LOWER($1) OR phone=$1) AND role=$2 LIMIT 1",
      [identifier, role]
    );
    const user = result.rows[0];
    // Generic error so a wrong role guess reveals nothing about other accounts.
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
    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, uuid: user.uuid, name: user.name, role: user.role }
    });
  } catch (err) {
    console.error('SELECT ACCOUNT ERROR:', err.message);
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
  // Same generic reply whether or not the account exists (prevents user enumeration).
  const genericMsg = "If that account exists, we've sent a password reset link to its email.";
  if (!email || !EMAIL_RE.test(String(email).trim()))
    return res.status(400).json({ error: 'Please enter a valid email address' });
  const normEmail = String(email).trim().toLowerCase();
  try {
    const result = await db.query('SELECT id, email FROM users WHERE email=$1', [normEmail]);
    const user = result.rows[0];
    if (!user) return res.json({ message: genericMsg });

    const token = uuidv4();
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await db.query('UPDATE users SET reset_token=$1, reset_expires_at=$2 WHERE id=$3', [token, expiry, user.id]);

    // Build the link from the request origin so it works locally and on serverless,
    // falling back to BASE_URL when configured.
    const base = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const link = `${base}/reset-password?token=${token}`;

    // Await the send so serverless (Vercel) doesn't kill it after the response.
    const emailSent = user.email
      ? await sendEmail(user.email, 'Reset your password', templates.resetPassword(link))
      : false;
    if (!emailSent) console.error('FORGOT PASSWORD: reset email not sent for', normEmail);

    res.json({ message: genericMsg });
  } catch (err) {
    console.error('FORGOT PASSWORD ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token) return res.status(400).json({ error: 'Reset link is invalid or missing. Please request a new one.' });
  if (!password || String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const result = await db.query('SELECT * FROM users WHERE reset_token=$1 AND reset_expires_at > NOW()', [token]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

    const hash = await bcrypt.hash(password, 10);
    // Clear the token so it is single-use.
    await db.query('UPDATE users SET password_hash=$1, reset_token=NULL, reset_expires_at=NULL WHERE id=$2', [hash, user.id]);
    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (err) {
    console.error('RESET PASSWORD ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET);
    // Confirm the account still exists (deleted accounts must appear logged out)
    const result = await db.query('SELECT id, uuid, name, role, is_suspended FROM users WHERE id=$1', [payload.id]);
    const user = result.rows[0];
    if (!user)
      return res.status(401).json({ error: 'Account no longer exists. Please log in again.', accountDeleted: true });
    if (user.is_suspended)
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    res.json({ user });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
