const router = require('express').Router();
const db = require('../utils/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { sendEmail, templates } = require('../utils/mailer');
const { notify } = require('../utils/notify');

// POST /api/requests
// optionalAuth: guests can still send a request, but when the caller IS signed in
// we know their id — which links the request to their account AND lets us block
// an owner from requesting their own listing.
router.post('/', optionalAuth, async (req, res) => {
  const { listing_uuid, seeker_name, seeker_phone, seeker_email, move_in_date, message } = req.body;
  if (!listing_uuid || !seeker_name || (!seeker_phone && !seeker_email)) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const lr = await db.query("SELECT id, title, owner_id FROM listings WHERE uuid=$1 AND status='active'", [listing_uuid]);
    const listing = lr.rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const seeker_id = req.session.user?.id || null;
    // An owner cannot send a request to their own listing.
    if (seeker_id && seeker_id === listing.owner_id)
      return res.status(403).json({ error: "You can't send a request to your own room" });
    const result = await db.query(
      'INSERT INTO contact_requests (listing_id, seeker_id, seeker_name, seeker_phone, seeker_email, move_in_date, message) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING uuid',
      [listing.id, seeker_id, seeker_name, seeker_phone || null, seeker_email || null, move_in_date || null, message || null]
    );

    await db.query('UPDATE listings SET interest_count = interest_count + 1 WHERE id=$1', [listing.id]);

    // The request is saved — that is the user's success condition. Respond NOW
    // and let the notifications/emails run in the background. Awaiting SMTP was
    // holding the response for several seconds, which left the seeker staring at
    // "Sending..." long after the request had actually gone through.
    res.status(201).json({ message: 'Interest submitted. We will contact you shortly.', uuid: result.rows[0].uuid });

    // Fire-and-forget side effects. Each is isolated so one failure (e.g. SMTP
    // down) cannot reject the others or affect the response already sent.
    (async () => {
      const ownerRes = await db.query('SELECT email FROM users WHERE id=$1', [listing.owner_id]);
      const owner = ownerRes.rows[0];
      if (owner?.email) await sendEmail(owner.email, 'New Interest in Your Listing', templates.interestReceived(listing.title));
    })().catch(err => console.error('interest owner email failed:', err.message));

    // In-app notification to the owner (dashboard "My listings").
    notify(listing.owner_id, 'interestReceived', [listing.title], { link: '/dashboard#listings' })
      .catch(err => console.error('interest owner notify failed:', err.message));

    if (seeker_email) {
      sendEmail(seeker_email, 'Request Received', templates.requestUpdate('received', listing.title))
        .catch(err => console.error('interest seeker email failed:', err.message));
    }
    // In-app confirmation to the signed-in seeker (dashboard "My requests").
    if (seeker_id) {
      notify(seeker_id, 'requestUpdate', ['received', listing.title], { link: '/dashboard#requests' })
        .catch(err => console.error('interest seeker notify failed:', err.message));
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/requests/:uuid
// A seeker withdraws ("unrequests") one of their own requests. Removing the row
// makes the seeker's list drop it, the listing's "Request Sent" button revert to
// normal (has_requested checks for ANY row), and the row disappear from the
// admin requests table — which reads this same contact_requests table.
router.delete('/:uuid', requireAuth, async (req, res) => {
  try {
    const seekerId = req.session.user.id;
    // Only the request's OWN seeker may withdraw it, and only while it is still
    // in a pending state. Once an admin has moved it to connected/closed the
    // connection already happened, so withdrawing is not allowed.
    const fr = await db.query(
      `SELECT cr.id, cr.listing_id, cr.status, l.title, l.owner_id
         FROM contact_requests cr JOIN listings l ON l.id = cr.listing_id
        WHERE cr.uuid=$1 AND cr.seeker_id=$2`,
      [req.params.uuid, seekerId]
    );
    const request = fr.rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status === 'connected' || request.status === 'closed')
      return res.status(409).json({ error: 'This request has already been handled and can no longer be withdrawn' });

    await db.query('DELETE FROM contact_requests WHERE id=$1', [request.id]);
    // Undo the interest bump from POST /api/requests so the listing's count stays
    // honest (never below zero).
    await db.query('UPDATE listings SET interest_count = GREATEST(interest_count - 1, 0) WHERE id=$1', [request.listing_id]);

    res.json({ message: 'Request withdrawn' });

    // Fire-and-forget: let the owner know so the withdrawal is visible on their
    // side too (dashboard notifications), and the admin list already lost the row.
    notify(request.owner_id, 'requestCancelled', [request.title], { link: '/dashboard#listings' })
      .catch(err => console.error('request cancel owner notify failed:', err.message));
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
