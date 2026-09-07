const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

const kycStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/kyc')),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const kycUpload = multer({ storage: kycStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/user/profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const [[user]] = await db.query('SELECT id, uuid, name, email, phone, role, is_verified, is_kyc_verified, wallet_balance, avatar, created_at FROM users WHERE id=?', [req.session.user.id]);
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/listings — owner's own listings
router.get('/listings', requireAuth, async (req, res) => {
  try {
    const [listings] = await db.query(`
      SELECT l.uuid, l.title, l.status, l.listed_price, l.views_count, l.interest_count, l.created_at, l.expires_at,
             img.image_path as primary_image
      FROM listings l
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = 1
      WHERE l.owner_id = ?
      ORDER BY l.created_at DESC`, [req.session.user.id]);
    res.json({ listings });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/favorites
router.get('/favorites', requireAuth, async (req, res) => {
  try {
    const [favorites] = await db.query(`
      SELECT l.uuid, l.title, l.location_area, l.listed_price, l.price_per_head, l.occupancy_type,
             img.image_path as primary_image, f.created_at as saved_at
      FROM favorites f
      JOIN listings l ON f.listing_id = l.id
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = 1
      WHERE f.user_id = ? AND l.status = 'active'
      ORDER BY f.created_at DESC`, [req.session.user.id]);
    res.json({ favorites });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/notifications
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const [notifications] = await db.query('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30', [req.session.user.id]);
    await db.query('UPDATE notifications SET is_read=1 WHERE user_id=?', [req.session.user.id]);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/kyc — submit KYC documents
router.post('/kyc', requireAuth, kycUpload.fields([{ name: 'id_doc', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]), async (req, res) => {
  if (!req.files?.id_doc || !req.files?.selfie) return res.status(400).json({ error: 'Both ID document and selfie required' });
  try {
    await db.query('UPDATE users SET kyc_doc_path=?, kyc_selfie_path=? WHERE id=?', [
      `/uploads/kyc/${req.files.id_doc[0].filename}`,
      `/uploads/kyc/${req.files.selfie[0].filename}`,
      req.session.user.id
    ]);
    res.json({ message: 'KYC documents submitted for review' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/payout-request
router.post('/payout-request', requireAuth, async (req, res) => {
  const { amount, payment_method, account_number } = req.body;
  if (!amount || !payment_method || !account_number) return res.status(400).json({ error: 'All fields required' });
  try {
    const [[user]] = await db.query('SELECT wallet_balance FROM users WHERE id=?', [req.session.user.id]);
    if (parseFloat(amount) > user.wallet_balance) return res.status(400).json({ error: 'Insufficient balance' });
    await db.query('INSERT INTO payout_requests (owner_id, amount, payment_method, account_number) VALUES (?,?,?,?)',
      [req.session.user.id, amount, payment_method, account_number]);
    res.json({ message: 'Payout request submitted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/user/role-upgrade — request owner role
router.put('/role-upgrade', requireAuth, async (req, res) => {
  try {
    const [[user]] = await db.query('SELECT role, is_kyc_verified FROM users WHERE id=?', [req.session.user.id]);
    if (user.role === 'owner') return res.status(400).json({ error: 'Already an owner' });
    if (!user.is_kyc_verified) return res.status(403).json({ error: 'KYC verification required before posting' });
    await db.query('UPDATE users SET role="owner" WHERE id=?', [req.session.user.id]);
    req.session.user.role = 'owner';
    res.json({ message: 'Role upgraded to owner' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
