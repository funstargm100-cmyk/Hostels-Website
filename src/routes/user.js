const router = require('express').Router();
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

// GET /api/user/profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT id, uuid, name, email, phone, role, is_verified, is_kyc_verified, wallet_balance, avatar, created_at FROM users WHERE id=$1', [req.session.user.id]);
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/user/listings
router.get('/listings', requireAuth, async (req, res) => {
  try {
    const [listings] = await db.query2(`
      SELECT l.uuid, l.title, l.status, l.listed_price, l.views_count, l.interest_count, l.created_at, l.expires_at, l.location_area,
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
