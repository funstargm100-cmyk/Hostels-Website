const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { requireRole } = require('../middleware/auth');

const PLATFORM_FEE_RATE = 0.05;
const OWNER_COMMISSION_RATE = 0.05;

// POST /api/payments/record — admin records a completed payment
router.post('/record', requireRole('admin'), async (req, res) => {
  const { contact_request_id, payment_method, payment_ref } = req.body;
  try {
    const [[request]] = await db.query(`
      SELECT cr.*, l.listed_price, l.owner_id FROM contact_requests cr
      JOIN listings l ON cr.listing_id = l.id
      WHERE cr.id = ? AND cr.status = 'connected'`, [contact_request_id]);

    if (!request) return res.status(404).json({ error: 'Request not found or not connected' });

    const total = parseFloat(request.listed_price);
    const platform_fee = parseFloat((total * PLATFORM_FEE_RATE).toFixed(2));
    const owner_commission = parseFloat((total * OWNER_COMMISSION_RATE).toFixed(2));

    await db.query(
      'INSERT INTO transactions (uuid, contact_request_id, listing_id, owner_id, total_amount, platform_fee, owner_commission, payment_method, payment_ref, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [uuidv4(), contact_request_id, request.listing_id, request.owner_id, total, platform_fee, owner_commission, payment_method, payment_ref || null, 'completed']
    );

    await db.query('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?', [owner_commission, request.owner_id]);
    await db.query('UPDATE contact_requests SET status="closed" WHERE id=?', [contact_request_id]);

    res.json({ message: 'Payment recorded', platform_fee, owner_commission });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/payments/summary — owner earnings summary
router.get('/summary', requireRole('owner', 'agent', 'admin'), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [[summary]] = await db.query(`
      SELECT COALESCE(SUM(owner_commission),0) as total_earned,
             COUNT(*) as total_bookings,
             COALESCE(SUM(CASE WHEN status='completed' THEN owner_commission END),0) as paid_out
      FROM transactions WHERE owner_id=?`, [userId]);
    const [[wallet]] = await db.query('SELECT wallet_balance FROM users WHERE id=?', [userId]);
    res.json({ ...summary, wallet_balance: wallet.wallet_balance });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
