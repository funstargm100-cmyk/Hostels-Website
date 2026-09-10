const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{9,15}$/;
const normalizePhone = (p) => (p || '').replace(/[\s()\-]/g, '');

// GET /api/user/profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT id, uuid, name, email, phone, role, is_verified, is_kyc_verified, wallet_balance, avatar, base_location, base_lat, base_lng, created_at FROM users WHERE id=$1', [req.session.user.id]);
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/user/profile  — edit name / email / phone / base location
router.put('/profile', requireAuth, async (req, res) => {
  const { name, email, phone, base_location } = req.body;
  if (!name || !name.trim() || name.trim().length < 2)
    return res.status(400).json({ error: 'Please enter your full name' });
  const normEmail = (email || '').trim().toLowerCase();
  const normPhone = normalizePhone(phone);
  if (!normEmail) return res.status(400).json({ error: 'A valid email address is required' });
  if (!EMAIL_RE.test(normEmail)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (normPhone && !PHONE_RE.test(normPhone)) return res.status(400).json({ error: 'Please enter a valid phone number (9–15 digits)' });
  try {
    // Reject a clash with any OTHER account before updating.
    const dupe = await db.query('SELECT email, phone FROM users WHERE (email=$1 OR phone=$2) AND id<>$3',
      [normEmail, normPhone || null, req.session.user.id]);
    for (const row of dupe.rows) {
      if (row.email === normEmail) return res.status(409).json({ error: 'That email is already used by another account' });
      if (normPhone && row.phone === normPhone) return res.status(409).json({ error: 'That phone number is already used by another account' });
    }
    const result = await db.query(
      `UPDATE users SET name=$1, email=$2, phone=$3, base_location=$4 WHERE id=$5
       RETURNING id, uuid, name, email, phone, role, is_verified, is_kyc_verified, wallet_balance, avatar, base_location, base_lat, base_lng, created_at`,
      [name.trim(), normEmail, normPhone || null, (base_location || '').trim() || null, req.session.user.id]);
    res.json({ message: 'Profile updated', user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That email or phone number is already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/user/password  — change password (requires the current one)
router.put('/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Please enter your current and new password' });
  if (String(new_password).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const result = await db.query('SELECT password_hash FROM users WHERE id=$1', [req.session.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Your current password is incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.session.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/user/activity  — merged feed of the most recent events for the dashboard "Recent activity"
router.get('/activity', requireAuth, async (req, res) => {
  const uid = req.session.user.id;
  const isOwner = req.session.user.role === 'owner' || req.session.user.role === 'agent';
  try {
    let rows;
    if (isOwner) {
      [rows] = await db.query2(`
        SELECT 'posted' AS type, l.title, l.uuid AS listing_uuid, NULL AS status, l.views_count AS count, l.created_at AS ts
          FROM listings l WHERE l.owner_id=$1
        UNION ALL
        SELECT 'status', l.title, l.uuid, l.status, NULL, l.updated_at
          FROM listings l WHERE l.owner_id=$1 AND l.status <> 'pending'
        UNION ALL
        SELECT 'interest', l.title, l.uuid, NULL, NULL, cr.created_at
          FROM contact_requests cr JOIN listings l ON l.id=cr.listing_id WHERE l.owner_id=$1
        UNION ALL
        SELECT 'views', l.title, l.uuid, NULL, l.views_count, l.updated_at
          FROM listings l WHERE l.owner_id=$1 AND l.views_count > 0
        ORDER BY ts DESC LIMIT 5`, [uid]);
    } else {
      [rows] = await db.query2(`
        SELECT 'interest' AS type, l.title, l.uuid AS listing_uuid, NULL AS status, NULL AS count, cr.created_at AS ts
          FROM contact_requests cr JOIN listings l ON l.id=cr.listing_id WHERE cr.seeker_id=$1
        UNION ALL
        SELECT 'status', l.title, l.uuid, cr.status, NULL, cr.updated_at
          FROM contact_requests cr JOIN listings l ON l.id=cr.listing_id
          WHERE cr.seeker_id=$1 AND cr.status <> 'received'
        UNION ALL
        SELECT 'saved', l.title, l.uuid, NULL, NULL, f.created_at
          FROM favorites f JOIN listings l ON l.id=f.listing_id WHERE f.user_id=$1
        ORDER BY ts DESC LIMIT 5`, [uid]);
    }
    res.json({ events: rows });
  } catch (err) {
    console.error('ACTIVITY ERROR:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/listings
router.get('/listings', requireAuth, async (req, res) => {
  try {
    const [listings] = await db.query2(`
      SELECT l.uuid, l.title, l.status, l.price_per_head, l.views_count, l.interest_count, l.created_at, l.expires_at, l.location_area,
             img.image_path as primary_image
      FROM listings l
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = TRUE
      WHERE l.owner_id = $1
      ORDER BY l.created_at DESC`, [req.session.user.id]);
    res.json({ listings });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/user/favorites
router.get('/favorites', requireAuth, async (req, res) => {
  try {
    const [favorites] = await db.query2(`
      SELECT l.uuid, l.title, l.location_area, l.listed_price, l.price_per_head, l.occupancy_type,
             img.image_path as primary_image, f.created_at as saved_at
      FROM favorites f
      JOIN listings l ON f.listing_id = l.id
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = TRUE
      WHERE f.user_id = $1 AND l.status = 'active'
      ORDER BY f.created_at DESC`, [req.session.user.id]);
    res.json({ favorites });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/user/notifications
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const [notifications] = await db.query2('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [req.session.user.id]);
    await db.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [req.session.user.id]);
    res.json({ notifications });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


// POST /api/user/payout-request
router.post('/payout-request', requireAuth, async (req, res) => {
  const { amount, payment_method, account_number } = req.body;
  if (!amount || !payment_method || !account_number) return res.status(400).json({ error: 'All fields required' });
  try {
    const result = await db.query('SELECT wallet_balance FROM users WHERE id=$1', [req.session.user.id]);
    if (parseFloat(amount) > parseFloat(result.rows[0].wallet_balance)) return res.status(400).json({ error: 'Insufficient balance' });
    await db.query('INSERT INTO payout_requests (owner_id, amount, payment_method, account_number) VALUES ($1,$2,$3,$4)',
      [req.session.user.id, amount, payment_method, account_number]);
    res.json({ message: 'Payout request submitted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/user/role-upgrade
router.put('/role-upgrade', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT role FROM users WHERE id=$1', [req.session.user.id]);
    const user = result.rows[0];
    if (user.role === 'owner') return res.status(400).json({ error: 'Already an owner' });
    await db.query("UPDATE users SET role='owner' WHERE id=$1", [req.session.user.id]);
    req.session.user.role = 'owner';
    res.json({ message: 'Role upgraded to owner' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
