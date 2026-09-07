const router = require('express').Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validateAdContent } = require('../utils/contactDetector');
const { applyLocationJitter, calculateDistance } = require('../utils/location');

// Use memory storage — Vercel has no writable filesystem
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|jpg|png|webp)/.test(file.mimetype))
});

const COMMISSION_RATE = 0.10;

// GET /api/listings
router.get('/', async (req, res) => {
  try {
    const { location, min_price, max_price, occupancy, gender, water, electricity, wifi, parking, furnished, bathroom, sort, page = 1, limit = 12 } = req.query;
    const offset = (page - 1) * limit;
    const where = ['l.status = \'active\''];
    const params = [];
    let p = 1;

    if (location) { where.push(`(l.location_area ILIKE $${p} OR l.nearest_landmark ILIKE $${p+1})`); params.push(`%${location}%`, `%${location}%`); p += 2; }
    if (min_price) { where.push(`l.listed_price >= $${p++}`); params.push(min_price); }
    if (max_price) { where.push(`l.listed_price <= $${p++}`); params.push(max_price); }
    if (occupancy) { where.push(`l.occupancy_type = $${p++}`); params.push(occupancy); }
    if (gender) { where.push(`l.gender_preference = $${p++}`); params.push(gender); }
    if (wifi === '1') { where.push('a.wifi = TRUE'); }
    if (parking === '1') { where.push('a.parking = TRUE'); }
    if (water) { where.push(`a.water = $${p++}`); params.push(water); }
    if (electricity) { where.push(`a.electricity = $${p++}`); params.push(electricity); }
    if (furnished) { where.push(`a.furnishing = $${p++}`); params.push(furnished); }
    if (bathroom) { where.push(`a.bathroom = $${p++}`); params.push(bathroom); }

    const orderMap = { price_asc: 'l.listed_price ASC', price_desc: 'l.listed_price DESC', newest: 'l.created_at DESC', rating: 'avg_rating DESC NULLS LAST' };
    const orderBy = orderMap[sort] || 'l.is_featured DESC, l.created_at DESC';
    const whereStr = `WHERE ${where.join(' AND ')}`;

    const sql = `
      SELECT l.id, l.uuid, l.title, l.location_area, l.nearest_landmark, l.listed_price, l.price_per_head,
             l.occupancy_type, l.gender_preference, l.is_featured, l.views_count, l.interest_count,
             l.move_in_date, l.created_at,
             u.is_kyc_verified as owner_verified,
             img.image_path as primary_image,
             ROUND(AVG(r.rating)::numeric, 1) as avg_rating, COUNT(r.id) as review_count,
             a.wifi, a.water, a.electricity, a.security, a.furnishing, a.bathroom, a.parking
      FROM listings l
      LEFT JOIN users u ON l.owner_id = u.id
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = TRUE
      LEFT JOIN reviews r ON r.listing_id = l.id
      LEFT JOIN amenities a ON a.listing_id = l.id
      ${whereStr}
      GROUP BY l.id, u.is_kyc_verified, img.image_path, a.wifi, a.water, a.electricity, a.security, a.furnishing, a.bathroom, a.parking
      ORDER BY ${orderBy}
      LIMIT $${p} OFFSET $${p+1}`;

    const [listings] = await db.query2(sql, [...params, parseInt(limit), parseInt(offset)]);
    const countRes = await db.query(`SELECT COUNT(DISTINCT l.id) as total FROM listings l LEFT JOIN amenities a ON a.listing_id = l.id ${whereStr}`, params);
    const total = parseInt(countRes.rows[0].total);

    res.json({ listings, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/listings/:uuid
router.get('/:uuid', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT l.*, u.name as owner_name, u.is_kyc_verified as owner_verified,
             ROUND(AVG(r.rating)::numeric, 1) as avg_rating, COUNT(r.id) as review_count
      FROM listings l
      LEFT JOIN users u ON l.owner_id = u.id
      LEFT JOIN reviews r ON r.listing_id = l.id
      WHERE l.uuid=$1 AND l.status='active'
      GROUP BY l.id, u.name, u.is_kyc_verified`, [req.params.uuid]);

    const listing = result.rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const [images] = await db.query2('SELECT image_path, is_primary FROM listing_images WHERE listing_id=$1 ORDER BY sort_order', [listing.id]);
    const amenitiesRes = await db.query('SELECT * FROM amenities WHERE listing_id=$1', [listing.id]);
    const amenities = amenitiesRes.rows[0];
    const [reviews] = await db.query2(`
      SELECT r.rating, r.comment, r.created_at, u.name as reviewer_name
      FROM reviews r JOIN users u ON r.reviewer_id = u.id
      WHERE r.listing_id=$1 ORDER BY r.created_at DESC LIMIT 10`, [listing.id]);

    const jittered = applyLocationJitter(parseFloat(listing.location_lat), parseFloat(listing.location_lng));
    listing.display_lat = jittered.lat;
    listing.display_lng = jittered.lng;
    delete listing.location_lat;
    delete listing.location_lng;

    await db.query('UPDATE listings SET views_count = views_count + 1 WHERE id=$1', [listing.id]);
    res.json({ listing, images, amenities, reviews });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/listings
router.post('/', requireAuth, upload.array('images', 10), async (req, res) => {
  const { title, description, occupancy_type, original_price, location_area, location_lat, location_lng, nearest_landmark, gender_preference, move_in_date, water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly } = req.body;

  if (!title || !original_price || !location_area || !occupancy_type) return res.status(400).json({ error: 'Missing required fields' });

  const contentCheck = validateAdContent(title, description);
  if (!contentCheck.isClean) return res.status(400).json({ error: 'Ad contains contact information. Remove it and resubmit.', violations: contentCheck.violations });
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'At least one image required' });

  try {
    const price = parseFloat(original_price);
    const listed_price = parseFloat((price * (1 + COMMISSION_RATE)).toFixed(2));
    const price_per_head = parseFloat((listed_price / parseInt(occupancy_type)).toFixed(2));
    const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const result = await db.query(
      `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, location_lat, location_lng, nearest_landmark, gender_preference, move_in_date, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, uuid`,
      [req.session.user.id, title, description, occupancy_type, price, listed_price, price_per_head, location_area, location_lat || null, location_lng || null, nearest_landmark || null, gender_preference || 'mixed', move_in_date || null, expires_at]
    );
    const { id: listingId, uuid } = result.rows[0];

    await db.query(
      `INSERT INTO amenities (listing_id, water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [listingId, water || 'none', electricity || 'none', security || 'none', furnishing || 'unfurnished', bathroom || 'shared', !!kitchen_access, !!wifi, !!parking, !!pet_friendly]
    );

    for (let i = 0; i < req.files.length; i++) {
      const b64 = `data:${req.files[i].mimetype};base64,${req.files[i].buffer.toString('base64')}`;
      await db.query('INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES ($1,$2,$3,$4)',
        [listingId, b64, i === 0, i]);
    }

    res.status(201).json({ message: 'Listing submitted for review', uuid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/listings/:uuid
router.put('/:uuid', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    const listing = result.rows[0];
    if (!listing && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Listing not found' });

    const { title, description, original_price, occupancy_type } = req.body;
    if (title || description) {
      const check = validateAdContent(title || listing.title, description || listing.description);
      if (!check.isClean) return res.status(400).json({ error: 'Contains contact info', violations: check.violations });
    }

    const fields = []; const vals = []; let p = 1;
    if (title) { fields.push(`title=$${p++}`); vals.push(title); }
    if (description) { fields.push(`description=$${p++}`); vals.push(description); }
    if (original_price) {
      const op = parseFloat(original_price);
      const lp = parseFloat((op * 1.10).toFixed(2));
      const pph = parseFloat((lp / (occupancy_type || listing.occupancy_type)).toFixed(2));
      fields.push(`original_price=$${p++}`, `listed_price=$${p++}`, `price_per_head=$${p++}`);
      vals.push(op, lp, pph);
    }
    fields.push(`status='pending'`);
    vals.push(req.params.uuid);
    await db.query(`UPDATE listings SET ${fields.join(', ')} WHERE uuid=$${p}`, vals);
    res.json({ message: 'Listing updated and resubmitted for review' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/listings/:uuid
router.delete('/:uuid', requireAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT id FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    if (!result.rows.length && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Not found' });
    await db.query("UPDATE listings SET status='deactivated' WHERE uuid=$1", [req.params.uuid]);
    res.json({ message: 'Listing deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/listings/:uuid/favorite
router.post('/:uuid/favorite', requireAuth, async (req, res) => {
  try {
    const lr = await db.query('SELECT id FROM listings WHERE uuid=$1', [req.params.uuid]);
    const listing = lr.rows[0];
    if (!listing) return res.status(404).json({ error: 'Not found' });
    const existing = await db.query('SELECT id FROM favorites WHERE user_id=$1 AND listing_id=$2', [req.session.user.id, listing.id]);
    if (existing.rows.length) {
      await db.query('DELETE FROM favorites WHERE user_id=$1 AND listing_id=$2', [req.session.user.id, listing.id]);
      return res.json({ favorited: false });
    }
    await db.query('INSERT INTO favorites (user_id, listing_id) VALUES ($1,$2)', [req.session.user.id, listing.id]);
    res.json({ favorited: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/listings/:uuid/report
router.post('/:uuid/report', requireAuth, async (req, res) => {
  const { reason, details } = req.body;
  try {
    const lr = await db.query('SELECT id FROM listings WHERE uuid=$1', [req.params.uuid]);
    const listing = lr.rows[0];
    if (!listing) return res.status(404).json({ error: 'Not found' });
    await db.query('INSERT INTO reports (reporter_id, listing_id, reason, details) VALUES ($1,$2,$3,$4)', [req.session.user.id, listing.id, reason, details || null]);
    res.json({ message: 'Report submitted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/listings/:uuid/distance
router.get('/:uuid/distance', async (req, res) => {
  const { from_lat, from_lng } = req.query;
  try {
    const result = await db.query("SELECT location_lat, location_lng FROM listings WHERE uuid=$1 AND status='active'", [req.params.uuid]);
    const listing = result.rows[0];
    if (!listing || !listing.location_lat) return res.status(404).json({ error: 'Location not available' });
    const jittered = applyLocationJitter(parseFloat(listing.location_lat), parseFloat(listing.location_lng));
    const dist = calculateDistance(parseFloat(from_lat), parseFloat(from_lng), jittered.lat, jittered.lng);
    res.json({ distance_km: dist.toFixed(2), estimated_travel_minutes: Math.round(dist / 40 * 60) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
