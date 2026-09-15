const router = require('express').Router();
const db = require('../utils/db');
const { requireRole } = require('../middleware/auth');
const { sendEmail, templates, REQUEST_STATUS_LABEL } = require('../utils/mailer');
const { notify, notifyFollowers } = require('../utils/notify');

const admin = requireRole('admin');

async function logAction(adminId, action, targetType, targetId, details) {
  await db.query('INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)',
    [adminId, action, targetType, targetId, details || null]);
}

// GET /api/admin/dashboard
router.get('/dashboard', admin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role != 'admin') as total_users,
        (SELECT COUNT(*) FROM listings WHERE status='active') as active_listings,
        (SELECT COUNT(*) FROM listings WHERE status='pending') as pending_listings,
        (SELECT COUNT(*) FROM contact_requests WHERE status='received') as new_requests,
        (SELECT COUNT(*) FROM reports WHERE status='open') as open_reports,
        (SELECT COALESCE(SUM(platform_fee),0) FROM transactions WHERE status='completed') as total_revenue,
        (SELECT COUNT(*) FROM transactions WHERE status='completed') as total_bookings`);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/listings
router.get('/listings', admin, async (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const [listings] = await db.query2(`
      SELECT l.*, u.name as owner_name, u.email as owner_email, u.is_kyc_verified as owner_verified,
             img.image_path as primary_image
      FROM listings l
      JOIN users u ON l.owner_id = u.id
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = TRUE
      WHERE l.status = $1
      ORDER BY l.created_at ASC LIMIT $2 OFFSET $3`, [status, parseInt(limit), parseInt(offset)]);
    res.json({ listings });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/listings/grouped  (every listing with its owner, for the "by user" view)
router.get('/listings/grouped', admin, async (req, res) => {
  try {
    const [listings] = await db.query2(`
      SELECT l.id, l.uuid, l.title, l.status, l.price_per_head, l.created_at,
             u.id as owner_id, u.name as owner_name, u.email as owner_email
      FROM listings l
      JOIN users u ON l.owner_id = u.id
      ORDER BY u.name ASC, l.created_at DESC`);
    res.json({ listings });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/admin/listings/:id/approve
router.put('/listings/:id/approve', admin, async (req, res) => {
  try {
    const result = await db.query('SELECT l.*, u.email, u.name as owner_name FROM listings l JOIN users u ON l.owner_id=u.id WHERE l.id=$1', [req.params.id]);
    const listing = result.rows[0];
    if (!listing) return res.status(404).json({ error: 'Not found' });
    await db.query("UPDATE listings SET status='active' WHERE id=$1", [req.params.id]);
    if (listing.email) await sendEmail(listing.email, `Your Rentel listing "${listing.title}" is now live`, templates.adApproved(listing.title, { uuid: listing.uuid, req }));
    await notify(listing.owner_id, 'adApproved', [listing.title], { link: '/dashboard#listings' });
    await notifyFollowers(listing.owner_id, listing.owner_name || 'A landlord you follow', listing.title, '/listings');
    await logAction(req.session.user.id, 'approve_listing', 'listing', req.params.id);
    res.json({ message: 'Listing approved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/listings/:id/reject
router.put('/listings/:id/reject', admin, async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await db.query('SELECT l.*, u.email FROM listings l JOIN users u ON l.owner_id=u.id WHERE l.id=$1', [req.params.id]);
    const listing = result.rows[0];
    if (!listing) return res.status(404).json({ error: 'Not found' });
    await db.query("UPDATE listings SET status='rejected', rejection_reason=$1 WHERE id=$2", [reason || 'Policy violation', req.params.id]);
    if (listing.email) await sendEmail(listing.email, `Action needed on your Rentel listing "${listing.title}"`, templates.adRejected(listing.title, reason, { uuid: listing.uuid, req }));
    await notify(listing.owner_id, 'adRejected', [listing.title, reason], { link: '/dashboard#listings' });
    await logAction(req.session.user.id, 'reject_listing', 'listing', req.params.id, reason);
    res.json({ message: 'Listing rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/listings/:id  (hard delete)
router.delete('/listings/:id', admin, async (req, res) => {
  try {
    const existing = await db.query('SELECT id, title, owner_id FROM listings WHERE id=$1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Listing not found' });
    const listing = existing.rows[0];
    const ownerRes = await db.query('SELECT email FROM users WHERE id=$1', [listing.owner_id]);
    if (ownerRes.rows[0]?.email) await sendEmail(ownerRes.rows[0].email, `Your Rentel listing "${listing.title}" has been removed`, templates.adDeleted(listing.title, { req }));
    await notify(listing.owner_id, 'adDeleted', [listing.title], { link: '/dashboard#listings' });
    await db.query('DELETE FROM listings WHERE id=$1', [req.params.id]);
    await logAction(req.session.user.id, 'delete_listing', 'listing', req.params.id);
    res.json({ message: 'Listing deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/admin/listings/:id/deactivate  (mark as unavailable)
router.put('/listings/:id/deactivate', admin, async (req, res) => {
  try {
    const existing = await db.query('SELECT l.id, l.title, l.uuid, l.owner_id, u.email as owner_email FROM listings l JOIN users u ON l.owner_id=u.id WHERE l.id=$1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Listing not found' });
    const listing = existing.rows[0];
    if (listing.owner_email) await sendEmail(listing.owner_email, `Your Rentel listing "${listing.title}" is temporarily unavailable`, templates.adUnavailable(listing.title, { uuid: listing.uuid, req }));
    await notify(listing.owner_id, 'adUnavailable', [listing.title], { link: '/dashboard#listings' });
    await db.query("UPDATE listings SET status='deactivated' WHERE id=$1", [req.params.id]);
    await logAction(req.session.user.id, 'deactivate_listing', 'listing', req.params.id);
    res.json({ message: 'Listing marked as unavailable' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/admin/listings/:id/reactivate  (restore availability)
router.put('/listings/:id/reactivate', admin, async (req, res) => {
  try {
    const existing = await db.query('SELECT l.id, l.title, l.uuid, l.owner_id, u.name as owner_name, u.email as owner_email FROM listings l JOIN users u ON l.owner_id=u.id WHERE l.id=$1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Listing not found' });
    const listing = existing.rows[0];
    if (listing.owner_email) await sendEmail(listing.owner_email, `Your Rentel listing "${listing.title}" is live again`, templates.adReactivated(listing.title, { uuid: listing.uuid, req }));
    await notify(listing.owner_id, 'adReactivated', [listing.title], { link: '/dashboard#listings' });
    await notifyFollowers(listing.owner_id, listing.owner_name || 'A landlord you follow', listing.title, '/listings');
    await db.query("UPDATE listings SET status='active' WHERE id=$1", [req.params.id]);
    await logAction(req.session.user.id, 'reactivate_listing', 'listing', req.params.id);
    res.json({ message: 'Listing reactivated' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/admin/requests
router.get('/requests', admin, async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const params = status ? [status, parseInt(limit), parseInt(offset)] : [parseInt(limit), parseInt(offset)];
    const where = status ? 'WHERE cr.status = $1' : '';
    const limitParam = status ? '$2' : '$1';
    const offsetParam = status ? '$3' : '$2';
    // Admins are trusted staff, so — unlike the public listing endpoints — this
    // returns the room's REAL coordinates (location_lat/lng, never the jittered
    // display_* pair) plus the full pricing breakdown (occupancy, per-person
    // price, agent commission, platform fee) so the admin modal can explain how
    // each room's price was calculated and show its exact pin.
    const [requests] = await db.query2(`
      SELECT cr.*, l.title as listing_title, l.uuid as listing_uuid,
             l.occupancy_type, l.original_price, l.listed_price, l.price_per_head,
             l.poster_type, l.commission_type, l.commission_value,
             l.platform_fee_rate, l.platform_fee,
             l.location_area, l.full_address, l.nearest_landmark,
             l.location_lat, l.location_lng,
             (SELECT image_path FROM listing_images li WHERE li.listing_id = l.id ORDER BY li.is_primary DESC, li.sort_order ASC LIMIT 1) as primary_image,
             u.name as owner_name, u.email as owner_email, u.phone as owner_phone
      FROM contact_requests cr
      JOIN listings l ON cr.listing_id = l.id
      JOIN users u ON l.owner_id = u.id
      ${where}
      ORDER BY cr.created_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`, params);
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/requests/:id/status
router.put('/requests/:id/status', admin, async (req, res) => {
  const { status, admin_notes } = req.body;
  const validStatuses = ['received', 'in_progress', 'connected', 'closed'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const result = await db.query(
      'SELECT cr.*, u.email, l.title AS listing_title FROM contact_requests cr LEFT JOIN users u ON cr.seeker_id=u.id LEFT JOIN listings l ON cr.listing_id=l.id WHERE cr.id=$1',
      [req.params.id]
    );
    const request = result.rows[0];
    if (!request) return res.status(404).json({ error: 'Not found' });
    // Only touch admin_notes when the client actually sent the field. A status-only
    // update (or an old client) must NOT blank a note that was saved earlier.
    if ('admin_notes' in req.body) {
      await db.query('UPDATE contact_requests SET status=$1, admin_notes=$2 WHERE id=$3', [status, admin_notes || null, req.params.id]);
    } else {
      await db.query('UPDATE contact_requests SET status=$1 WHERE id=$2', [status, req.params.id]);
    }
    const emailTo = request.seeker_email || request.email;
    const statusLabel = REQUEST_STATUS_LABEL[status] || status;
    if (emailTo) await sendEmail(emailTo, `Update on your Rentel request — now ${statusLabel}`, templates.requestUpdate(status, request.listing_title, { req }));
    if (request.seeker_id) await notify(request.seeker_id, 'requestUpdate', [status], { link: '/dashboard#requests' });
    await logAction(req.session.user.id, 'update_request_status', 'request', req.params.id, status);
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users
router.get('/users', admin, async (req, res) => {
  const { role, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const params = role ? [role, parseInt(limit), parseInt(offset)] : [parseInt(limit), parseInt(offset)];
    const where = role ? 'WHERE role = $1' : "WHERE role != 'admin'";
    const lp = role ? '$2' : '$1'; const op = role ? '$3' : '$2';
    const [users] = await db.query2(`SELECT id, uuid, name, email, phone, role, is_verified, is_kyc_verified, is_suspended, violation_count, wallet_balance, created_at FROM users ${where} ORDER BY created_at DESC LIMIT ${lp} OFFSET ${op}`, params);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/users/:id/suspend
router.put('/users/:id/suspend', admin, async (req, res) => {
  try {
    await db.query('UPDATE users SET is_suspended=TRUE WHERE id=$1', [req.params.id]);
    await logAction(req.session.user.id, 'suspend_user', 'user', req.params.id);
    res.json({ message: 'User suspended' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/admin/users/:id/unsuspend
router.put('/users/:id/unsuspend', admin, async (req, res) => {
  try {
    await db.query('UPDATE users SET is_suspended=FALSE WHERE id=$1', [req.params.id]);
    await logAction(req.session.user.id, 'unsuspend_user', 'user', req.params.id);
    res.json({ message: 'User unsuspended' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/admin/users/:id/verify-kyc
router.put('/users/:id/verify-kyc', admin, async (req, res) => {
  try {
    await db.query('UPDATE users SET is_kyc_verified=TRUE WHERE id=$1', [req.params.id]);
    await logAction(req.session.user.id, 'verify_kyc', 'user', req.params.id);
    res.json({ message: 'KYC verified' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /api/admin/users/:id  (permanently delete an account)
router.delete('/users/:id', admin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) return res.status(400).json({ error: 'Invalid user id' });
    if (targetId === req.session.user.id)
      return res.status(400).json({ error: 'You cannot delete your own admin account' });

    const u = await db.query('SELECT id, name, email, role FROM users WHERE id=$1', [targetId]);
    if (!u.rows.length) return res.status(404).json({ error: 'User not found' });
    if (u.rows[0].role === 'admin')
      return res.status(403).json({ error: 'Admin accounts cannot be deleted from here' });

    // reviews has no ON DELETE rule for reviewer_id — clear those first
    await db.query('DELETE FROM reviews WHERE reviewer_id=$1', [targetId]);
    // listings, favorites, notifications, reports cascade; contact_requests set seeker_id NULL
    await db.query('DELETE FROM users WHERE id=$1', [targetId]);
    await logAction(req.session.user.id, 'delete_user', 'user', targetId,
      JSON.stringify({ name: u.rows[0].name, email: u.rows[0].email }));
    res.json({ message: `Account "${u.rows[0].name}" and all their data deleted` });
  } catch (err) {
    console.error('DELETE USER ERROR:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/reports
router.get('/reports', admin, async (req, res) => {
  try {
    const [reports] = await db.query2(`
      SELECT r.*, u.name as reporter_name, l.title as listing_title, l.uuid as listing_uuid
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      LEFT JOIN listings l ON r.listing_id = l.id
      WHERE r.status = 'open'
      ORDER BY r.created_at DESC`);
    res.json({ reports });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/admin/reports/:id/resolve
router.put('/reports/:id/resolve', admin, async (req, res) => {
  try {
    await db.query("UPDATE reports SET status='resolved' WHERE id=$1", [req.params.id]);
    await logAction(req.session.user.id, 'resolve_report', 'listing', req.params.id);
    res.json({ message: 'Report resolved' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/admin/payouts
router.get('/payouts', admin, async (req, res) => {
  try {
    const [payouts] = await db.query2(`
      SELECT p.*, u.name as owner_name, u.email as owner_email
      FROM payout_requests p JOIN users u ON p.owner_id = u.id
      WHERE p.status = 'pending' ORDER BY p.created_at ASC`);
    res.json({ payouts });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// PUT /api/admin/payouts/:id/approve
router.put('/payouts/:id/approve', admin, async (req, res) => {
  try {
    const result = await db.query('SELECT p.*, u.email FROM payout_requests p JOIN users u ON p.owner_id=u.id WHERE p.id=$1', [req.params.id]);
    const payout = result.rows[0];
    if (!payout) return res.status(404).json({ error: 'Not found' });
    await db.query("UPDATE payout_requests SET status='paid' WHERE id=$1", [req.params.id]);
    await db.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id=$2', [payout.amount, payout.owner_id]);
    if (payout.email) await sendEmail(payout.email, `Your Rentel payout of GHS ${payout.amount} has been processed`, templates.payoutConfirmed(payout.amount, { req }));
    await logAction(req.session.user.id, 'approve_payout', 'payout', req.params.id);
    res.json({ message: 'Payout approved' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/admin/logs
router.get('/logs', admin, async (req, res) => {
  try {
    const [logs] = await db.query2(`
      SELECT al.*, u.name as admin_name FROM admin_logs al
      JOIN users u ON al.admin_id = u.id
      ORDER BY al.created_at DESC LIMIT 100`);
    res.json({ logs });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
