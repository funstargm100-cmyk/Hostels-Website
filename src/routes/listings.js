const router = require('express').Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const { validateAdContent } = require('../utils/contactDetector');
const { applyLocationJitter, calculateDistance } = require('../utils/location');
const { notifyFollowers } = require('../utils/notify');
const { storeImage } = require('../utils/imageStorage');

// Use memory storage — Vercel has no writable filesystem
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|jpg|png|webp)/.test(file.mimetype))
});

const COMMISSION_RATE = 0; // No transactions — price posted is price shown
const MAX_LISTING_PHOTOS = 10;

// Multipart form fields arrive as strings ("false" is truthy). Coerce checkbox
// values properly so an unchecked box really stores false, whichever content
// type the request used.
const toBool = (v) => v === true || v === 'true' || v === '1' || v === 'on';

// Apply photo edits to a listing: remove the given listing_images ids, store any
// new uploads, then re-order everything. Enforces the 10-photo cap on the FINAL
// total and guarantees exactly one primary (cover) image — the first in order.
// Returns an error string, or null on success.
//
// `photoOrder` is the desired sequence as identifiers:
//   number  -> an existing listing_images.id
//   'new:N' -> the Nth file in `files` (staged uploads)
// When it is absent the existing order is kept and new photos append at the end.
async function applyImageChanges(listingId, removeIds, files, photoOrder) {
  const existing = await db.query(
    'SELECT id FROM listing_images WHERE listing_id=$1 ORDER BY sort_order', [listingId]);
  const existingIds = existing.rows.map(r => r.id);
  const keptIds = existingIds.filter(id => !removeIds.includes(id));
  const newFiles = files || [];

  if (keptIds.length + newFiles.length > MAX_LISTING_PHOTOS)
    return `A room can have at most ${MAX_LISTING_PHOTOS} photos (you would end up with ${keptIds.length + newFiles.length}).`;
  if (keptIds.length === 0 && newFiles.length === 0)
    return 'A room needs at least one photo.';

  // Delete the removed rows (scoped to this listing so a stray id can't touch another listing).
  if (removeIds.length) {
    await db.query('DELETE FROM listing_images WHERE listing_id=$1 AND id = ANY($2::int[])', [listingId, removeIds]);
  }

  // Store each new upload up-front so we have a real id to order against.
  // newIds[n] corresponds to files[n] (i.e. the 'new:N' identifier).
  const newIds = [];
  for (const file of newFiles) {
    // storeImage throws on an unreadable upload — surface a friendly message.
    let imagePath;
    try {
      imagePath = await storeImage(file.buffer, file.originalname);
    } catch (imgErr) {
      return `Could not process image "${file.originalname}". Please use a JPG or PNG photo.`;
    }
    const ins = await db.query(
      'INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES ($1,$2,FALSE,0) RETURNING id',
      [listingId, imagePath]);
    newIds.push(ins.rows[0].id);
  }

  // Build the final sequence of ids. Only identifiers that genuinely belong to
  // this listing survive, so a tampered payload can't reorder someone else's row.
  let order = [];
  if (Array.isArray(photoOrder) && photoOrder.length) {
    const keptSet = new Set(keptIds);
    for (const token of photoOrder) {
      if (typeof token === 'string' && token.startsWith('new:')) {
        const idx = Number(token.slice(4));
        if (Number.isInteger(idx) && newIds[idx] !== undefined) order.push(newIds[idx]);
      } else {
        const id = Number(token);
        if (keptSet.has(id)) { order.push(id); keptSet.delete(id); }
      }
    }
    // Anything the client omitted (kept photos it didn't list, or new files it
    // forgot) is appended so no photo is ever silently lost.
    for (const id of keptIds) if (keptSet.has(id)) order.push(id);
    for (const id of newIds) if (!order.includes(id)) order.push(id);
  } else {
    order = [...keptIds, ...newIds];
  }

  // Persist order, and make the FIRST photo the single primary / cover image.
  for (let i = 0; i < order.length; i++) {
    await db.query('UPDATE listing_images SET sort_order=$1, is_primary=$2 WHERE id=$3 AND listing_id=$4',
      [i, i === 0, order[i], listingId]);
  }
  return null;
}

// GET /api/listings
router.get('/', async (req, res) => {
  try {
    const { location, min_price, max_price, occupancy, gender, water, electricity, wifi, parking, furnished, bathroom, sort, page = 1, limit = 12, near_lat, near_lng, near_km = 5 } = req.query;
    const offset = (page - 1) * limit;
    const where = ['l.status = \'active\''];
    const params = [];
    let p = 1;

    // Advanced search: every word must match somewhere (title, description,
    // area, landmark, or address). Multi-word phrases in quotes are kept whole.
    if (location) {
      const tokens = location.match(/"[^"]+"|\S+/g)?.map(t => t.replace(/"/g, '').trim()).filter(Boolean) || [];
      for (const tok of tokens) {
        const like = `%${tok}%`;
        where.push(`(l.location_area ILIKE $${p} OR l.nearest_landmark ILIKE $${p+1} OR l.full_address ILIKE $${p+2} OR l.title ILIKE $${p+3} OR l.description ILIKE $${p+4})`);
        params.push(like, like, like, like, like);
        p += 5;
      }
    }
    if (min_price) { where.push(`l.price_per_head >= $${p++}`); params.push(min_price); }
    if (max_price) { where.push(`l.price_per_head <= $${p++}`); params.push(max_price); }
    if (occupancy) { where.push(`l.occupancy_type = $${p++}`); params.push(occupancy); }
    if (gender) { where.push(`l.gender_preference = $${p++}`); params.push(gender); }
    if (wifi === '1') { where.push('a.wifi = TRUE'); }
    if (parking === '1') { where.push('a.parking = TRUE'); }
    if (water) { where.push(`a.water = $${p++}`); params.push(water); }
    if (electricity) { where.push(`a.electricity = $${p++}`); params.push(electricity); }
    if (furnished) { where.push(`a.furnishing = $${p++}`); params.push(furnished); }
    if (bathroom) { where.push(`a.bathroom = $${p++}`); params.push(bathroom); }
    // Proximity filter using Haversine formula
    if (near_lat && near_lng) {
      where.push(`(
        6371 * acos(
          cos(radians($${p})) * cos(radians(l.location_lat)) *
          cos(radians(l.location_lng) - radians($${p+1})) +
          sin(radians($${p})) * sin(radians(l.location_lat))
        )
      ) <= $${p+2}`);
      params.push(parseFloat(near_lat), parseFloat(near_lng), parseFloat(near_km));
      p += 3;
    }

    const orderMap = { price_asc: 'l.price_per_head ASC', price_desc: 'l.price_per_head DESC', newest: 'l.created_at DESC', rating: 'avg_rating DESC NULLS LAST' };
    let orderBy = orderMap[sort] || '';
    const whereParamCount = p - 1; // WHERE clauses use params[0..p-2] exclusively

    // Relevance ranking when searching without an explicit sort:
    // title matches > area/landmark/address matches > description matches,
    // then featured, then newest. Same $n placeholder is safely reused.
    if (location && !sort) {
      const tokens = location.match(/"[^"]+"|\S+/g)?.map(t => t.replace(/"/g, '').trim()).filter(Boolean) || [];
      const scoreParts = tokens.map(tok => {
        const n = p++;
        params.push(`%${tok}%`);
        return `(CASE
          WHEN l.title ILIKE $${n} THEN 3
          WHEN l.location_area ILIKE $${n} OR l.nearest_landmark ILIKE $${n} OR l.full_address ILIKE $${n} THEN 2
          WHEN l.description ILIKE $${n} THEN 1
          ELSE 0 END)`;
      });
      if (scoreParts.length) orderBy = `(${scoreParts.join(' + ')}) DESC, l.is_featured DESC, l.created_at DESC`;
    }
    if (!orderBy) orderBy = 'l.is_featured DESC, l.created_at DESC';
    const whereStr = `WHERE ${where.join(' AND ')}`;

    const sql = `
      SELECT l.id, l.uuid, l.title, l.location_area, l.full_address, l.nearest_landmark, l.listed_price, l.price_per_head,
             l.occupancy_type, l.gender_preference, l.is_featured, l.views_count, l.interest_count,
             l.move_in_date, l.created_at, l.location_lat, l.location_lng,
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

    // WHERE-only params for the count query (scoring params are ORDER BY-only)
    const whereParams = params.slice(0, whereParamCount);
    const [listings] = await db.query2(sql, [...params, parseInt(limit), parseInt(offset)]);
    // Coordinates: real ones power distance-to-base calculations in the client;
    // jittered ones are what map markers show, so exact pins stay private.
    for (const lst of listings) {
      if (lst.location_lat != null) {
        // Seed with the uuid so a room always plots at the SAME private point
        // (no teleporting between requests) — see applyLocationJitter.
        const jittered = applyLocationJitter(parseFloat(lst.location_lat), parseFloat(lst.location_lng), lst.uuid);
        lst.display_lat = jittered.lat;
        lst.display_lng = jittered.lng;
      }
    }
    const countRes = await db.query(`SELECT COUNT(DISTINCT l.id) as total FROM listings l LEFT JOIN amenities a ON a.listing_id = l.id ${whereStr}`, whereParams);
    const total = parseInt(countRes.rows[0].total);

    res.json({ listings, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/listings/:uuid
// optionalAuth so the owner (or an admin) can open their OWN listing even when it
// is deactivated/unavailable/pending — public visitors only ever see active ones.
router.get('/:uuid', optionalAuth, async (req, res) => {
  try {
    const viewer = req.session.user;
    const result = await db.query(`
      SELECT l.*, u.name as owner_name, u.is_kyc_verified as owner_verified,
             ROUND(AVG(r.rating)::numeric, 1) as avg_rating, COUNT(r.id) as review_count
      FROM listings l
      LEFT JOIN users u ON l.owner_id = u.id
      LEFT JOIN reviews r ON r.listing_id = l.id
      WHERE l.uuid=$1 AND (l.status='active' OR l.owner_id=$2 OR $3=TRUE)
      GROUP BY l.id, u.name, u.is_kyc_verified`, [req.params.uuid, viewer?.id || null, viewer?.role === 'admin']);

    const listing = result.rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const [images] = await db.query2('SELECT image_path, is_primary FROM listing_images WHERE listing_id=$1 ORDER BY sort_order', [listing.id]);
    const amenitiesRes = await db.query('SELECT * FROM amenities WHERE listing_id=$1', [listing.id]);
    const amenities = amenitiesRes.rows[0];
    const [reviews] = await db.query2(`
      SELECT r.rating, r.comment, r.created_at, u.name as reviewer_name
      FROM reviews r JOIN users u ON r.reviewer_id = u.id
      WHERE r.listing_id=$1 ORDER BY r.created_at DESC LIMIT 10`, [listing.id]);

    // Same uuid seed as the list endpoint, so the detail page shows the room at
    // the exact spot the map pin used.
    const jittered = applyLocationJitter(parseFloat(listing.location_lat), parseFloat(listing.location_lng), listing.uuid);
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
router.post('/', requireAuth, requireRole('owner', 'agent', 'admin'), upload.array('images', 10), async (req, res) => {
  const { title, description, occupancy_type, original_price, location_area, location_lat, location_lng, nearest_landmark, gender_preference, move_in_date, water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly } = req.body;

  if (!title || !original_price || !location_area || !occupancy_type) return res.status(400).json({ error: 'Missing required fields' });

  const contentCheck = validateAdContent(title, description);
  if (!contentCheck.isClean) return res.status(400).json({ error: 'Ad contains contact information. Remove it and resubmit.', violations: contentCheck.violations });
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'At least one image required' });

  try {
    const price = parseFloat(original_price);
    const listed_price = price;
    const price_per_head = parseFloat((listed_price / parseInt(occupancy_type)).toFixed(2));
    const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const result = await db.query(
      `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, location_area, full_address, location_lat, location_lng, nearest_landmark, gender_preference, move_in_date, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, uuid`,
      [req.session.user.id, title, description, occupancy_type, price, listed_price, price_per_head, location_area, req.body.full_address || null, location_lat || null, location_lng || null, nearest_landmark || null, gender_preference || 'mixed', move_in_date || null, expires_at]
    );
    const { id: listingId, uuid } = result.rows[0];

    await db.query(
      `INSERT INTO amenities (listing_id, water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [listingId, water || 'none', electricity || 'none', security || 'none', furnishing || 'unfurnished', bathroom || 'shared', !!kitchen_access, !!wifi, !!parking, !!pet_friendly]
    );

    for (let i = 0; i < req.files.length; i++) {
      try {
        const imagePath = await storeImage(req.files[i].buffer, req.files[i].originalname);
        await db.query('INSERT INTO listing_images (listing_id, image_path, is_primary, sort_order) VALUES ($1,$2,$3,$4)',
          [listingId, imagePath, i === 0, i]);
      } catch (imgErr) {
        console.error('Image processing failed:', imgErr.message);
        return res.status(400).json({ error: `Could not process image "${req.files[i].originalname}". Please use a JPG or PNG photo.` });
      }
    }

    res.status(201).json({ message: 'Listing submitted for review', uuid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/listings/:uuid
// Accepts multipart/uploads too, so the owner can delete existing photos and add
// new ones while editing. `remove_image_ids` (JSON array or CSV) lists
// listing_images.id values to drop. The 10-photos-per-listing cap is enforced
// against the FINAL count, not just the newly uploaded files.
router.put('/:uuid', requireAuth, upload.array('images', 10), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    const listing = result.rows[0];
    if (!listing && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Listing not found' });

    const { title, description, original_price, occupancy_type, location_area, full_address, nearest_landmark, gender_preference, move_in_date,
            location_lat, location_lng,
            water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly } = req.body;
    if (title || description) {
      const check = validateAdContent(title || listing.title, description || listing.description);
      if (!check.isClean) return res.status(400).json({ error: 'Contains contact info', violations: check.violations });
    }

    const fields = []; const vals = []; let p = 1;
    if (title) { fields.push(`title=$${p++}`); vals.push(title); }
    if (description !== undefined) { fields.push(`description=$${p++}`); vals.push(description); }
    if (location_area) { fields.push(`location_area=$${p++}`); vals.push(location_area); }
    if (full_address !== undefined) { fields.push(`full_address=$${p++}`); vals.push(full_address); }
    if (nearest_landmark !== undefined) { fields.push(`nearest_landmark=$${p++}`); vals.push(nearest_landmark); }
    if (location_lat !== undefined && location_lat !== '') { fields.push(`location_lat=$${p++}`); vals.push(parseFloat(location_lat)); }
    if (location_lng !== undefined && location_lng !== '') { fields.push(`location_lng=$${p++}`); vals.push(parseFloat(location_lng)); }
    if (gender_preference) { fields.push(`gender_preference=$${p++}`); vals.push(gender_preference); }
    if (move_in_date) { fields.push(`move_in_date=$${p++}`); vals.push(move_in_date); }
    if (original_price) {
      const op = parseFloat(original_price);
      const occ = parseInt(occupancy_type || listing.occupancy_type);
      const lp = op; // price posted is price shown (no platform fee)
      const pph = parseFloat((lp / occ).toFixed(2));
      fields.push(`original_price=$${p++}`, `listed_price=$${p++}`, `price_per_head=$${p++}`);
      vals.push(op, lp, pph);
    }
    if (occupancy_type && original_price) { fields.push(`occupancy_type=$${p++}`); vals.push(parseInt(occupancy_type)); }
    // Editing an existing listing must NOT send it back through admin review —
    // an already-approved room stays live. Only new posts (POST /) require review.
    vals.push(req.params.uuid);
    await db.query(`UPDATE listings SET ${fields.join(', ')} WHERE uuid=$${p}`, vals);

    // Update amenities if any provided
    if (water || electricity || security || furnishing || bathroom !== undefined || kitchen_access !== undefined || wifi !== undefined || parking !== undefined || pet_friendly !== undefined) {
      const aFields = []; const aVals = []; let ap = 1;
      if (water) { aFields.push(`water=$${ap++}`); aVals.push(water); }
      if (electricity) { aFields.push(`electricity=$${ap++}`); aVals.push(electricity); }
      if (security) { aFields.push(`security=$${ap++}`); aVals.push(security); }
      if (furnishing) { aFields.push(`furnishing=$${ap++}`); aVals.push(furnishing); }
      if (bathroom) { aFields.push(`bathroom=$${ap++}`); aVals.push(bathroom); }
      if (kitchen_access !== undefined) { aFields.push(`kitchen_access=$${ap++}`); aVals.push(toBool(kitchen_access)); }
      if (wifi !== undefined) { aFields.push(`wifi=$${ap++}`); aVals.push(toBool(wifi)); }
      if (parking !== undefined) { aFields.push(`parking=$${ap++}`); aVals.push(toBool(parking)); }
      if (pet_friendly !== undefined) { aFields.push(`pet_friendly=$${ap++}`); aVals.push(toBool(pet_friendly)); }
      aVals.push(listing.id);
      await db.query(`UPDATE amenities SET ${aFields.join(', ')} WHERE listing_id=$${ap}`, aVals);
    }

    // ── Photos: delete removed ones, then add new uploads ────────────────────
    // `remove_image_ids` may arrive as a JSON array (multipart fields are strings)
    // or a comma-separated list. Only ids that belong to THIS listing are removed.
    let removeIds = [];
    if (req.body.remove_image_ids) {
      try {
        const parsed = typeof req.body.remove_image_ids === 'string'
          ? JSON.parse(req.body.remove_image_ids)
          : req.body.remove_image_ids;
        removeIds = (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
      } catch { /* ignore malformed input */ }
    }

    // `photo_order` is the desired sequence: existing ids as numbers, staged
    // uploads as 'new:N'. Optional — when absent the current order is kept.
    let photoOrder = null;
    if (req.body.photo_order) {
      try {
        const parsed = typeof req.body.photo_order === 'string'
          ? JSON.parse(req.body.photo_order)
          : req.body.photo_order;
        if (Array.isArray(parsed)) photoOrder = parsed;
      } catch { /* ignore malformed input */ }
    }

    const imageErr = await applyImageChanges(listing.id, removeIds, req.files, photoOrder);
    if (imageErr) return res.status(400).json({ error: imageErr });

    res.json({ message: 'Listing updated' });
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

// PUT /api/listings/:uuid/reactivate  — owner brings a deactivated listing back online
router.put('/:uuid/reactivate', requireAuth, async (req, res) => {
  try {
    const owned = await db.query('SELECT id, status FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    if (!owned.rows.length && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Not found' });
    if (owned.rows.length && owned.rows[0].status === 'active') return res.status(400).json({ error: 'Listing is already active' });
    // Bring it back online. Going through 'pending' would demand a re-review, but
    // reactivating a listing its owner paused should be instant.
    await db.query("UPDATE listings SET status='active' WHERE uuid=$1", [req.params.uuid]);
    const followers = await db.query('SELECT COUNT(*)::int as c FROM follows WHERE poster_id=$1', [req.session.user.id]);
    if (followers.rows[0].c > 0) {
      const lRes = await db.query('SELECT title FROM listings WHERE uuid=$1', [req.params.uuid]);
      await notifyFollowers(req.session.user.id, req.session.user.name, lRes.rows[0]?.title, '/listings');
    }
    res.json({ message: 'Listing reactivated', status: 'active' });
  } catch (err) {
    console.error('REACTIVATE ERROR:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/listings/:uuid/permanent  — owner permanently removes a listing
router.delete('/:uuid/permanent', requireAuth, async (req, res) => {
  try {
    const owned = await db.query('SELECT id FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    if (!owned.rows.length && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Not found' });
    // Images, amenities, requests, favorites and reports all cascade from the listing.
    await db.query('DELETE FROM listings WHERE uuid=$1', [req.params.uuid]);
    res.json({ message: 'Listing permanently deleted' });
  } catch (err) {
    console.error('DELETE LISTING ERROR:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/listings/:uuid/availability  — owner marks listing available / unavailable
router.put('/:uuid/availability', requireAuth, async (req, res) => {
  try {
    const { available } = req.body;
    const status = available ? 'active' : 'unavailable';
    const owner = await db.query('SELECT id FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    if (!owner.rows.length && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE listings SET status=$1 WHERE uuid=$2', [status, req.params.uuid]);
    res.json({ message: available ? 'Listing marked as available' : 'Listing marked as unavailable', status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/listings/:uuid/edit-data — owner fetches full listing + amenities for the edit form
router.get('/:uuid/edit-data', requireAuth, async (req, res) => {
  try {
    const lr = await db.query('SELECT * FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    if (!lr.rows.length && req.session.user.role !== 'admin') return res.status(404).json({ error: 'Listing not found' });
    const listing = lr.rows[0];
    const amenities = (await db.query('SELECT * FROM amenities WHERE listing_id=$1', [listing.id])).rows[0] || {};
    const images = (await db.query('SELECT id, image_path, is_primary FROM listing_images WHERE listing_id=$1 ORDER BY sort_order', [listing.id])).rows;
    res.json({ listing, amenities, images });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/listings/:uuid/favorite
router.post('/:uuid/favorite', requireAuth, async (req, res) => {
  try {
    const lr = await db.query('SELECT id, owner_id FROM listings WHERE uuid=$1', [req.params.uuid]);
    const listing = lr.rows[0];
    if (!listing) return res.status(404).json({ error: 'Not found' });
    // An owner cannot favourite their own listing.
    if (listing.owner_id === req.session.user.id)
      return res.status(403).json({ error: "You can't save your own room" });
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
    // Seeded with the same uuid so the distance is measured to the SAME private
    // point the map pin shows (and stays stable between calls).
    const jittered = applyLocationJitter(parseFloat(listing.location_lat), parseFloat(listing.location_lng), req.params.uuid);
    const dist = calculateDistance(parseFloat(from_lat), parseFloat(from_lng), jittered.lat, jittered.lng);
    res.json({ distance_km: dist.toFixed(2), estimated_travel_minutes: Math.round(dist / 40 * 60) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
