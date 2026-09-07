const router = require('express').Router();
const db = require('../utils/db');
const { requireAuth } = require('../middleware/auth');
const { sendEmail, templates } = require('../utils/mailer');

// POST /api/requests
router.post('/', async (req, res) => {
  const { listing_uuid, seeker_name, seeker_phone, seeker_email, move_in_date, message } = req.body;
  if (!listing_uuid || !seeker_name || (!seeker_phone && !seeker_email)) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const lr = await db.query("SELECT id, title, owner_id FROM listings WHERE uuid=$1 AND status='active'", [listing_uuid]);
    const listing = lr.rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const seeker_id = req.session.user?.id || null;
    const result = await db.query(
      'INSERT INTO contact_requests (listing_id, seeker_id, seeker_name, seeker_phone, seeker_email, move_in_date, message) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING uuid',
      [listing.id, seeker_id, seeker_name, seeker_phone || null, seeker_email || null, move_in_date || null, message || null]
    );

    await db.query('UPDATE listings SET interest_count = interest_count + 1 WHERE id=$1', [listing.id]);

    const ownerRes = await db.query('SELECT email FROM users WHERE id=$1', [listing.owner_id]);
    const owner = ownerRes.rows[0];
    if (owner?.email) await sendEmail(owner.email, 'New Interest in Your Listing', templates.interestReceived(listing.title));
    if (seeker_email) await sendEmail(seeker_email, 'Request Received', templates.requestUpdate('received'));

    res.status(201).json({ message: 'Interest submitted. We will contact you shortly.', uuid: result.rows[0].uuid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/requests/mine
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const [requests] = await db.query2(`
      SELECT cr.uuid, cr.status, cr.move_in_date, cr.created_at, cr.message,
             l.title as listing_title, l.uuid as listing_uuid, l.location_area,
             img.image_path as listing_image
      FROM contact_requests cr
      JOIN listings l ON cr.listing_id = l.id
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = TRUE
      WHERE cr.seeker_id = $1
      ORDER BY cr.created_at DESC`, [req.session.user.id]);
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/requests/:uuid/review
router.post('/:uuid/review', requireAuth, async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1–5' });
  try {
    const result = await db.query("SELECT * FROM contact_requests WHERE uuid=$1 AND seeker_id=$2 AND status='connected'", [req.params.uuid, req.session.user.id]);
    const request = result.rows[0];
    if (!request) return res.status(403).json({ error: 'Can only review after a confirmed connection' });

    await db.query(
      'INSERT INTO reviews (listing_id, reviewer_id, contact_request_id, rating, comment) VALUES ($1,$2,$3,$4,$5)',
      [request.listing_id, req.session.user.id, request.id, rating, comment || null]
    );
    res.json({ message: 'Review submitted' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Already reviewed' });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
