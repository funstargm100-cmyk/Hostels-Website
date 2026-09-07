const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateAdContent } = require('../utils/contactDetector');
const { applyLocationJitter } = require('../utils/location');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/listings')),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  cb(null, /image\/(jpeg|jpg|png|webp)/.test(file.mimetype));
}});

const COMMISSION_RATE = 0.10;

// GET /api/listings — search & filter
router.get('/', async (req, res) => {
  try {
    const { location, min_price, max_price, occupancy, gender, water, electricity, wifi, parking, furnished, bathroom, sort, page = 1, limit = 12 } = req.query;
    const offset = (page - 1) * limit;
    let where = ['l.status = "active"'];
    const params = [];

    if (location) { where.push('(l.location_area LIKE ? OR l.nearest_landmark LIKE ?)'); params.push(`%${location}%`, `%${location}%`); }
    if (min_price) { where.push('l.listed_price >= ?'); params.push(min_price); }
    if (max_price) { where.push('l.listed_price <= ?'); params.push(max_price); }
    if (occupancy) { where.push('l.occupancy_type = ?'); params.push(occupancy); }
    if (gender) { where.push('l.gender_preference = ?'); params.push(gender); }
    if (wifi === '1') { where.push('a.wifi = 1'); }
    if (parking === '1') { where.push('a.parking = 1'); }
    if (water) { where.push('a.water = ?'); params.push(water); }
    if (electricity) { where.push('a.electricity = ?'); params.push(electricity); }
    if (furnished) { where.push('a.furnishing = ?'); params.push(furnished); }
    if (bathroom) { where.push('a.bathroom = ?'); params.push(bathroom); }

    const orderMap = { price_asc: 'l.listed_price ASC', price_desc: 'l.listed_price DESC', newest: 'l.created_at DESC', rating: 'avg_rating DESC' };
    const orderBy = orderMap[sort] || 'l.is_featured DESC, l.created_at DESC';

    const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `
      SELECT l.id, l.uuid, l.title, l.location_area, l.nearest_landmark, l.listed_price, l.price_per_head,
             l.occupancy_type, l.gender_preference, l.is_featured, l.views_count, l.interest_count,
             l.move_in_date, l.created_at,
             u.is_kyc_verified as owner_verified,
             img.image_path as primary_image,
             ROUND(AVG(r.rating), 1) as avg_rating, COUNT(r.id) as review_count,
             a.wifi, a.water, a.electricity, a.security, a.furnishing, a.bathroom, a.parking
      FROM listings l
      LEFT JOIN users u ON l.owner_id = u.id
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = 1
      LEFT JOIN reviews r ON r.listing_id = l.id
      LEFT JOIN amenities a ON a.listing_id = l.id
      ${whereStr}
      GROUP BY l.id
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`;

    const [listings] = await db.query(sql, [...params, parseInt(limit), parseInt(offset)]);
    const [[{ total }]] = await db.query(`SELECT COUNT(DISTINCT l.id) as total FROM listings l LEFT JOIN amenities a ON a.listing_id = l.id ${whereStr}`, params);

    res.json({ listings, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/listings/:uuid — single listing detail
router.get('/:uuid', async (req, res) => {
  try {
    const [[listing]] = await db.query(`
      SELECT l.*, u.name as owner_name, u.is_kyc_verified as owner_verified,
             ROUND(AVG(r.rating), 1) as avg_rating, COUNT(r.id) as review_count
      FROM listings l
      LEFT JOIN users u ON l.owner_id = u.id
      LEFT JOIN reviews r ON r.listing_id = l.id
      WHERE l.uuid = ? AND l.status = 'active'
      GROUP BY l.id`, [req.params.uuid]);

    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const [images] = await db.query('SELECT image_path, is_primary FROM listing_images WHERE listing_id=? ORDER BY sort_order', [listing.id]);
    const [[amenities]] = await db.query('SELECT * FROM amenities WHERE listing_id=?', [listing.id]);
    const [reviews] = await db.query(`
      SELECT r.rating, r.comment, r.created_at, u.name as reviewer_name
      FROM reviews r JOIN users u ON r.reviewer_id = u.id
      WHERE r.listing_id=? ORDER BY r.created_at DESC LIMIT 10`, [listing.id]);

    // Apply location jitter for privacy
    const jittered = applyLocationJitter(listing.location_lat, listing.location_lng);
    listing.display_lat = jittered.lat;
    listing.display_lng = jittered.lng;
    delete listing.location_lat;
    delete listing.location_lng;

    // Increment view count
    await db.query('UPDATE listings SET views_count = views_count + 1 WHERE id=?', [listing.id]);

    res.json({ listing, images, amenities, reviews });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/listings — create listing (owner only)
router.post('/', requireAuth, requireRole('owner', 'agent', 'admin'), upload.array('images', 10), async (req, res) => {
  const { title, description, occupancy_type, original_price, location_area, location_lat, location_lng, nearest_landmark, gender_preference, move_in_date, water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly } = req.body;

  if (!title || !original_price || !location_area || !occupancy_type) return res.status(400).json({ error: 'Missing required fields' });

  const contentCheck = validateAdContent(title, description);
  if (!contentCheck.isClean) return res.status(400).json({ error: 'Ad contains contact information. Remove it and resubmit.', violations: contentCheck.violations });

  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'At least one image required' });

  try {
    const price = parseFloat(original_price);
    const listed_price = parseFloat((price * (1 + COMMISSION_RATE)).toFixed(2));
    const price_per_head = parseFloat((listed_price / parseInt(occupancy_type)).toFixed(2));
    const uuid = uuidv4();
    const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const [result] = await db.query(
      `INSERT INTO listings (uuid, owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, location_lat, location_lng, nearest_landmark, gender_preference, move_in_date, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuid, req.session.user.id, title, description, occupancy_type, price, listed_price, price_per_head, location_area, location_lat || null, location_lng || null, nearest_landmark || null, gender_preference || 'mixed', move_in_date || null, expires_at]
    );

    const listingId = result.insertId;

    await db.query(
      `INSERT INTO amenities (listing_id, water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [listingId, water || 'none', electricity || 'none', security || 'none', furnishing || 'unfurnished', bathroom || 'shared', kitchen_access ? 1 : 0, wifi ? 1 : 0, parking ? 1 : 0, pet_friendly ? 1 : 0]
    );

    for (let i = 0; i < req.files.length; i++) {
      await db.query('INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES (?,?,?,?)',
        [listingId, `/uploads/listings/${req.files[i].filename}`, i === 0 ? 1 : 0, i]);
    }

    res.status(201).json({ message: 'Listing submitted for review', uuid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/listings/:uuid — update listing
router.put('/:uuid', requireAuth, async (req, res) => {
  try {
    const [[listing]] = await db.query('SELECT * FROM listings WHERE uuid=? AND owner_id=?', [req.params.uuid, req.session.user.id]);
    if (!listing && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Listing not found' });

    const { title, description, original_price, occupancy_type } = req.body;
    if (title || description) {
      const check = validateAdContent(title || listing.title, description || listing.description);
      if (!check.isClean) return res.status(400).json({ error: 'Contains contact info', violations: check.violations });
    }

    const updates = {};
    if (title) updates.title = title;
    if (description) updates.description = description;
    if (original_price) {
      updates.original_price = parseFloat(original_price);
      updates.listed_price = parseFloat((updates.original_price * 1.10).toFixed(2));
      updates.price_per_head = parseFloat((updates.listed_price / (occupancy_type || listing.occupancy_type)).toFixed(2));
    }
    updates.status = 'pending'; // re-moderate on edit

    const fields = Object.keys(updates).map(k => `${k}=?`).join(', ');
    await db.query(`UPDATE listings SET ${fields} WHERE uuid=?`, [...Object.values(updates), req.params.uuid]);
    res.json({ message: 'Listing updated and resubmitted for review' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/listings/:uuid — deactivate
router.delete('/:uuid', requireAuth, async (req, res) => {
  try {
    const [[listing]] = await db.query('SELECT id FROM listings WHERE uuid=? AND owner_id=?', [req.params.uuid, req.session.user.id]);
    if (!listing && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE listings SET status="deactivated" WHERE uuid=?', [req.params.uuid]);
    res.json({ message: 'Listing deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/listings/:uuid/favorite
router.post('/:uuid/favorite', requireAuth, async (req, res) => {
  try {
    const [[listing]] = await db.query('SELECT id FROM listings WHERE uuid=?', [req.params.uuid]);
    if (!listing) return res.status(404).json({ error: 'Not found' });
    const [[existing]] = await db.query('SELECT id FROM favorites WHERE user_id=? AND listing_id=?', [req.session.user.id, listing.id]);
    if (existing) {
      await db.query('DELETE FROM favorites WHERE user_id=? AND listing_id=?', [req.session.user.id, listing.id]);
      return res.json({ favorited: false });
    }
    await db.query('INSERT INTO favorites (user_id, listing_id) VALUES (?,?)', [req.session.user.id, listing.id]);
    res.json({ favorited: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/listings/:uuid/report
router.post('/:uuid/report', requireAuth, async (req, res) => {
  const { reason, details } = req.body;
  try {
    const [[listing]] = await db.query('SELECT id FROM listings WHERE uuid=?', [req.params.uuid]);
    if (!listing) return res.status(404).json({ error: 'Not found' });
    await db.query('INSERT INTO reports (reporter_id, listing_id, reason, details) VALUES (?,?,?,?)', [req.session.user.id, listing.id, reason, details || null]);
    res.json({ message: 'Report submitted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/listings/:uuid/distance
router.get('/:uuid/distance', async (req, res) => {
  const { from_lat, from_lng } = req.query;
  try {
    const [[listing]] = await db.query('SELECT location_lat, location_lng FROM listings WHERE uuid=? AND status="active"', [req.params.uuid]);
    if (!listing || !listing.location_lat) return res.status(404).json({ error: 'Location not available' });

    const { calculateDistance } = require('../utils/location');
    const jittered = applyLocationJitter(listing.location_lat, listing.location_lng);
    const dist = calculateDistance(parseFloat(from_lat), parseFloat(from_lng), jittered.lat, jittered.lng);
    const travelMinutes = Math.round(dist / 40 * 60); // ~40km/h average

    res.json({ distance_km: dist.toFixed(2), estimated_travel_minutes: travelMinutes });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
