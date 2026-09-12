// Public ad-poster (owner / agent) profiles + follow system.
// Seekers can open a poster's profile to browse ALL their active listings,
// and follow them so they get an in-app notification whenever a new room
// goes live from that poster.
const router = require('express').Router();
const db = require('../utils/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { applyLocationJitter } = require('../utils/location');

// GET /api/users/:id  — public profile of an ad-poster
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });

    const uRes = await db.query(
      `SELECT id, name, role, avatar, is_kyc_verified, created_at
       FROM users WHERE id=$1 AND role IN ('owner','agent')`,
      [id]
    );
    const poster = uRes.rows[0];
    if (!poster) return res.status(404).json({ error: 'Ad poster not found' });

    const [listings] = await db.query2(`
      SELECT l.id, l.uuid, l.title, l.location_area, l.nearest_landmark, l.listed_price, l.price_per_head,
             l.occupancy_type, l.gender_preference, l.is_featured, l.views_count, l.interest_count,
             l.move_in_date, l.created_at, l.location_lat, l.location_lng,
             img.image_path as primary_image,
             ROUND(AVG(r.rating)::numeric, 1) as avg_rating, COUNT(r.id) as review_count,
             a.wifi, a.water, a.electricity, a.furnishing, a.parking
      FROM listings l
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = TRUE
      LEFT JOIN reviews r ON r.listing_id = l.id
      LEFT JOIN amenities a ON a.listing_id = l.id
      WHERE l.owner_id=$1 AND l.status='active'
      GROUP BY l.id, img.image_path, a.wifi, a.water, a.electricity, a.furnishing, a.parking
      ORDER BY l.is_featured DESC, l.created_at DESC`, [id]);

    for (const lst of listings) {
      if (lst.location_lat != null) {
        const jittered = applyLocationJitter(parseFloat(lst.location_lat), parseFloat(lst.location_lng), lst.uuid);
        lst.display_lat = jittered.lat;
        lst.display_lng = jittered.lng;
      }
    }

    let following = false;
    const viewer = req.session.user;
    if (viewer) {
      const f = await db.query('SELECT 1 FROM follows WHERE follower_id=$1 AND poster_id=$2', [viewer.id, id]);
      following = f.rows.length > 0;
    }
    const followersRes = await db.query('SELECT COUNT(*)::int as count FROM follows WHERE poster_id=$1', [id]);

    res.json({
      poster: {
        id: poster.id,
        name: poster.name,
        role: poster.role,
        avatar: poster.avatar,
        is_kyc_verified: poster.is_kyc_verified,
        created_at: poster.created_at,
        listing_count: listings.length
      },
      listings,
      following,
      followers: followersRes.rows[0].count
    });
  } catch (err) {
    console.error('POSTER PROFILE ERROR:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/:id/follow  — toggle follow (signed-in users only)
router.post('/:id/follow', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });
    if (id === req.session.user.id) return res.status(400).json({ error: "You can't follow yourself" });

    const posterRes = await db.query("SELECT id FROM users WHERE id=$1 AND role IN ('owner','agent')", [id]);
    if (!posterRes.rows.length) return res.status(404).json({ error: 'Ad poster not found' });

    const existing = await db.query('SELECT id FROM follows WHERE follower_id=$1 AND poster_id=$2', [req.session.user.id, id]);
    if (existing.rows.length) {
      await db.query('DELETE FROM follows WHERE follower_id=$1 AND poster_id=$2', [req.session.user.id, id]);
      return res.json({ following: false });
    }
    await db.query('INSERT INTO follows (follower_id, poster_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.session.user.id, id]);
    res.json({ following: true });
  } catch (err) {
    console.error('FOLLOW ERROR:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/user/following  — list of posters the signed-in user follows
router.get('/me/following', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query2(`
      SELECT u.id, u.name, u.role, u.avatar, u.is_kyc_verified,
             (SELECT COUNT(*) FROM listings l WHERE l.owner_id=u.id AND l.status='active') as active_listings
      FROM follows f JOIN users u ON f.poster_id = u.id
      WHERE f.follower_id=$1
      ORDER BY f.created_at DESC`, [req.session.user.id]);
    res.json({ following: rows });
  } catch (err) {
    console.error('FOLLOWING ERROR:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
