const router = require('express').Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/db');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const { validateAdContent } = require('../utils/contactDetector');
const { applyLocationJitter, calculateDistance } = require('../utils/location');
const { notifyFollowers } = require('../utils/notify');
const { storeImage } = require('../utils/imageStorage');

// How many people may share a room (the "N-in-1" occupancy). The poster picks a
// value from 1..MAX_OCCUPANCY; both routes clamp to this range so a direct API call
// cannot create a nonsensical occupancy (the pricing maths multiplies by it).
const MAX_OCCUPANCY = 6;
function clampOccupancy(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(n, 1), MAX_OCCUPANCY);
}

// Use memory storage — Vercel has no writable filesystem.
//
// fileSize is the PER-FILE cap. The client compresses before uploading (see
// compressImage in public/js/app.js), so a well-behaved request is well under
// this; the cap exists to bound memory if someone posts directly to the API.
//
// 4MB rather than 5MB on purpose: several of these travel in ONE multipart body,
// and the platform rejects the whole request above roughly 4.5MB. A single file
// larger than this can never produce a body the platform will accept, so
// allowing it only moves the failure later, to a less explicable place.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
// Declared here (rather than with the other limits below) because the multer
// setup and its error handler both reference it at module load time.
const MAX_LISTING_PHOTOS = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_LISTING_PHOTOS + 1 },
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|jpg|png|webp)/.test(file.mimetype))
});

// Multer reports a too-large upload as an error, which would otherwise surface
// as a bare 500 or (worse, on serverless) as FUNCTION_PAYLOAD_TOO_LARGE with no
// useful body. Translate it into a real 413 the client can explain.
function uploadErrorHandler(err, req, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `Each photo must be under ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB. Try a smaller image.`,
      code: 'FILE_TOO_LARGE'
    });
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: `Too many photos — a room can have at most ${MAX_LISTING_PHOTOS}.`,
      code: 'TOO_MANY_FILES'
    });
  }
  return next(err);
}
const uploadListingImages = [upload.array('images', MAX_LISTING_PHOTOS), uploadErrorHandler];

const COMMISSION_RATE = 0; // No transactions — price posted is price shown

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
  // A room must carry at least TWO photos (the cover plus at least one more) — the
  // same rule enforced when posting. Checked on the FINAL total, so removing photos
  // down to one is rejected here.
  if (keptIds.length + newFiles.length < 2)
    return 'A room needs at least 2 photos.';

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
// optionalAuth so a signed-in viewer's saved rooms come back flagged
// (`favorited`), letting cards paint the heart filled on load instead of only
// after a click. Guests simply get favorited=false everywhere.
router.get('/', optionalAuth, async (req, res) => {
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

    // Is THIS viewer's saved-room flag. Anonymous viewers get a constant false,
    // so the same query shape works with or without a signed-in user.
    const viewerId = req.user ? req.user.id : null;
    const favSelect = viewerId
      ? 'f.user_id IS NOT NULL as favorited'
      : 'FALSE as favorited';
    const favJoin = viewerId
      ? `LEFT JOIN favorites f ON f.listing_id = l.id AND f.user_id = $${p++}`
      : '';
    const favGroup = viewerId ? ', f.user_id' : '';
    if (viewerId) params.push(viewerId);

    const sql = `
      SELECT l.id, l.uuid, l.title, l.location_area, l.full_address, l.nearest_landmark, l.listed_price, l.price_per_head,
             l.occupancy_type, l.gender_preference, l.is_featured, l.views_count, l.interest_count,
             l.move_in_date, l.created_at, l.location_lat, l.location_lng,
             u.is_kyc_verified as owner_verified,
             img.image_path as primary_image,
             ${favSelect},
             ROUND(AVG(r.rating)::numeric, 1) as avg_rating, COUNT(r.id) as review_count,
             a.wifi, a.water, a.electricity, a.security, a.furnishing, a.bathroom, a.parking
      FROM listings l
      LEFT JOIN users u ON l.owner_id = u.id
      LEFT JOIN listing_images img ON img.listing_id = l.id AND img.is_primary = TRUE
      LEFT JOIN reviews r ON r.listing_id = l.id
      LEFT JOIN amenities a ON a.listing_id = l.id
      ${favJoin}
      ${whereStr}
      GROUP BY l.id, u.is_kyc_verified, img.image_path, a.wifi, a.water, a.electricity, a.security, a.furnishing, a.bathroom, a.parking${favGroup}
      ORDER BY ${orderBy}
      LIMIT $${p} OFFSET $${p+1}`;

    // WHERE-only params for the count query (scoring params are ORDER BY-only).
    // whereParamCount stops before the favorites viewer id, which the count query
    // does not reference, it is sliced off here.
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
      SELECT l.*, u.name as owner_name, u.avatar as owner_avatar, u.role as owner_role,
             u.is_kyc_verified as owner_verified,
             (SELECT COUNT(*)::int FROM follows WHERE poster_id = l.owner_id) as owner_followers,
             ROUND(AVG(r.rating)::numeric, 1) as avg_rating, COUNT(r.id) as review_count
      FROM listings l
      LEFT JOIN users u ON l.owner_id = u.id
      LEFT JOIN reviews r ON r.listing_id = l.id
      WHERE l.uuid=$1 AND (l.status='active' OR l.owner_id=$2 OR $3=TRUE)
      GROUP BY l.id, u.name, u.avatar, u.role, u.is_kyc_verified`, [req.params.uuid, viewer?.id || null, viewer?.role === 'admin']);

    const listing = result.rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    let isFollowingOwner = false;
    if (viewer && listing.owner_id) {
      const fCheck = await db.query('SELECT 1 FROM follows WHERE follower_id=$1 AND poster_id=$2', [viewer.id, listing.owner_id]);
      isFollowingOwner = fCheck.rows.length > 0;
    }
    listing.is_following_owner = isFollowingOwner;

    // Viewer-specific state for the detail page's action buttons, so they paint
    // correctly on load (not only after a click):
    //   favorited      -> heart starts filled if this room is already saved
    //   has_requested  -> Request button reads "Request Sent" and is disabled
    // Guests get both false. An owner viewing their own room also gets false for
    // has_requested (the UI hides the button for owners anyway).
    let favorited = false;
    let has_requested = false;
    if (viewer && viewer.id !== listing.owner_id) {
      const fRow = await db.query('SELECT 1 FROM favorites WHERE user_id=$1 AND listing_id=$2', [viewer.id, listing.id]);
      favorited = fRow.rows.length > 0;
      const rRow = await db.query('SELECT 1 FROM contact_requests WHERE seeker_id=$1 AND listing_id=$2 LIMIT 1', [viewer.id, listing.id]);
      has_requested = rRow.rows.length > 0;
    }
    listing.favorited = favorited;
    listing.has_requested = has_requested;

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
router.post('/', requireAuth, requireRole('owner', 'agent', 'admin'), uploadListingImages, async (req, res) => {
  const { title, description, occupancy_type, original_price, price_per_head: price_per_head_in, location_area, nearest_landmark, gender_preference, move_in_date, water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly, poster_type, commission_type, commission_value } = req.body;
  // The post-ad wizard names the pin fields lat/lng (see post-ad.html), while the
  // edit form uses location_lat/location_lng. Accept BOTH spellings: reading only
  // location_lat/location_lng silently stored NULL for every room posted through
  // the wizard, so those rooms loaded into the grid but never plotted a map pin
  // (renderMapListings skips a listing whose coordinates are not finite).
  const location_lat = req.body.location_lat ?? req.body.lat;
  const location_lng = req.body.location_lng ?? req.body.lng;

  // The advertiser may supply EITHER price_per_head (which the post-ad wizard now
  // uses to carry the entered ROOM PRICE — see below) or original_price (legacy
  // room total). Require one of them.
  const hasPrice = (price_per_head_in !== undefined && price_per_head_in !== '') || !!original_price;
  if (!title || !hasPrice || !location_area || !occupancy_type) return res.status(400).json({ error: 'Missing required fields' });

  // Gender preference: only the three known values are accepted; anything else
  // (or nothing) falls back to 'mixed' ("Any"). This keeps the DB CHECK happy and
  // means an older client that never sends the field still gets a valid default.
  const VALID_GENDERS = ['male', 'female', 'mixed'];
  const genderPref = VALID_GENDERS.includes(gender_preference) ? gender_preference : 'mixed';

  const contentCheck = validateAdContent(title, description);
  if (!contentCheck.isClean) return res.status(400).json({ error: 'Ad contains contact information. Remove it and resubmit.', violations: contentCheck.violations });
  // A listing must carry at least TWO photos (the building cover plus at least one
  // more) — a single image is not enough to judge a room. Enforced here as well as
  // in the wizard, so a direct API post cannot slip a one-photo listing through.
  if (!req.files || req.files.length < 2) return res.status(400).json({ error: 'At least 2 photos are required (the building cover plus at least one more).' });
  // The rest of the wizard's required fields, enforced server-side too.
  if (!description || !String(description).trim()) return res.status(400).json({ error: 'Description is required' });
  if (!nearest_landmark || !String(nearest_landmark).trim()) return res.status(400).json({ error: 'Nearest landmark is required' });
  if (!water || !electricity || !furnishing || !bathroom) return res.status(400).json({ error: 'All amenities are required' });

  try {
    // The poster enters the PRICE PER PERSON (P). Occupancy (occ) is how many
    // people share the room. The platform fee is a PER-PERSON figure.
    //   AGENT: C = commission per occupant (flat GHS, amount only)
    //     totalCommission = C × occ
    //     platformFee     = 5% × ((totalCommission × occ) + P)
    //     totalPerPerson  = P + C + platformFee
    //   OWNER (no commission):
    //     totalForOcc     = P × occ
    //     platformFee     = 7% × P
    //     totalPerPerson  = P + platformFee
    // We store: original_price/listed_price = the WHOLE ROOM total
    // (totalPerPerson × occ) — what a full room costs and what payments settle
    // against; price_per_head = the seeker-facing total per person.
    const occ = clampOccupancy(occupancy_type);
    const pricePerPerson = (price_per_head_in !== undefined && price_per_head_in !== '')
      ? parseFloat(parseFloat(price_per_head_in).toFixed(2))
      : parseFloat(original_price);
    if (!Number.isFinite(pricePerPerson) || pricePerPerson <= 0) return res.status(400).json({ error: 'A valid price per person is required' });
    const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // ── Poster type, commission & platform fee ──────────────────────────────
    // Computed/validated HERE — the client's numbers are a convenience for the
    // live preview, never the source of truth.
    const kind = poster_type === 'agent' ? 'agent' : 'owner';
    const feeRate = kind === 'agent' ? 0.05 : 0.07;
    let commType = null;
    let commValue = null;   // commission PER OCCUPANT (GHS), agents only
    let commission = 0;     // TOTAL commission across all occupants
    if (kind === 'agent') {
      // Commission is a flat GHS amount per occupant (no percentage).
      commType = 'amount';
      commValue = parseFloat(commission_value);
      if (!Number.isFinite(commValue) || commValue <= 0) {
        return res.status(400).json({ error: 'An agent commission amount (per occupant) is required.' });
      }
      commValue = parseFloat(commValue.toFixed(2));
      commission = parseFloat((commValue * occ).toFixed(2));
    }
    // Platform fee: agent -> 5% of ((total commission × occupancy) + per-person
    // price); owner -> 7% of the per-person price.
    const feeBasePerPerson = kind === 'agent'
      ? parseFloat(((commission * occ) + pricePerPerson).toFixed(2))
      : pricePerPerson;
    const platformFee = parseFloat((feeBasePerPerson * feeRate).toFixed(2));
    const commissionPerPerson = kind === 'agent' ? commValue : 0;
    // What ONE occupant pays, and the whole room (all occupants).
    const price_per_head = parseFloat((pricePerPerson + commissionPerPerson + platformFee).toFixed(2));
    const price = parseFloat((price_per_head * occ).toFixed(2));
    const listed_price = price;

  const result = await db.query(
      `INSERT INTO listings (owner_id, title, description, occupancy_type, original_price, listed_price, price_per_head, base_price_per_head, location_area, full_address, location_lat, location_lng, nearest_landmark, gender_preference, move_in_date, expires_at, poster_type, commission_type, commission_value, platform_fee_rate, platform_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id, uuid`,
      [req.session.user.id, title, description, occupancy_type, price, listed_price, price_per_head, pricePerPerson, location_area, req.body.full_address || null, location_lat || null, location_lng || null, nearest_landmark || null, genderPref, move_in_date || null, expires_at, kind, commType, commValue, feeRate, platformFee]
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
router.put('/:uuid', requireAuth, uploadListingImages, async (req, res) => {
  try {
    // Owners edit their own listing; an admin may edit ANY listing (including one
    // still in review/pending). So the owner scope is applied for everyone else,
    // and admins look the row up by uuid alone — otherwise `listing` would be
    // undefined for an admin editing someone else's room and every later read of
    // listing.status / listing.id / listing.occupancy_type would throw a 500.
    const isAdmin = req.session.user.role === 'admin';
    const result = isAdmin
      ? await db.query('SELECT * FROM listings WHERE uuid=$1', [req.params.uuid])
      : await db.query('SELECT * FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    const listing = result.rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const { title, description, original_price, price_per_head: price_per_head_in, occupancy_type, location_area, full_address, nearest_landmark, gender_preference, move_in_date,
            location_lat, location_lng,
            water, electricity, security, furnishing, bathroom, kitchen_access, wifi, parking, pet_friendly } = req.body;
    // (Required-field checks run just below, after the ad-content scan.)
    if (title || description) {
      const check = validateAdContent(title || listing.title, description || listing.description);
      if (!check.isClean) return res.status(400).json({ error: 'Contains contact info', violations: check.violations });
    }
    // The edit form must leave a room fully filled in — the same rules as posting.
    // Enforced when the field is present but blank (the edit form always sends all
    // of them), so a direct API caller cannot blank out a required field.
    const blank = (v) => v !== undefined && v !== null && String(v).trim() === '';
    if (title !== undefined && blank(title)) return res.status(400).json({ error: 'Title is required' });
    if (description !== undefined && blank(description)) return res.status(400).json({ error: 'Description is required' });
    if (location_area !== undefined && blank(location_area)) return res.status(400).json({ error: 'Location area is required' });
    if (nearest_landmark !== undefined && blank(nearest_landmark)) return res.status(400).json({ error: 'Nearest landmark is required' });
    if (water !== undefined && blank(water)) return res.status(400).json({ error: 'Water supply is required' });
    if (electricity !== undefined && blank(electricity)) return res.status(400).json({ error: 'Electricity is required' });
    if (furnishing !== undefined && blank(furnishing)) return res.status(400).json({ error: 'Furnishing is required' });
    if (bathroom !== undefined && blank(bathroom)) return res.status(400).json({ error: 'Bathroom type is required' });

    const fields = []; const vals = []; let p = 1;
    if (title) { fields.push(`title=$${p++}`); vals.push(title); }
    if (description !== undefined) { fields.push(`description=$${p++}`); vals.push(description); }
    if (location_area) { fields.push(`location_area=$${p++}`); vals.push(location_area); }
    if (full_address !== undefined) { fields.push(`full_address=$${p++}`); vals.push(full_address); }
    if (nearest_landmark !== undefined) { fields.push(`nearest_landmark=$${p++}`); vals.push(nearest_landmark); }
    if (location_lat !== undefined && location_lat !== '') { fields.push(`location_lat=$${p++}`); vals.push(parseFloat(location_lat)); }
    if (location_lng !== undefined && location_lng !== '') { fields.push(`location_lng=$${p++}`); vals.push(parseFloat(location_lng)); }
    // Only the three known values are accepted, so an invalid one can never reach
    // the DB CHECK constraint. Blank/'mixed' both mean "Any".
    if (gender_preference !== undefined) {
      const VALID_GENDERS = ['male', 'female', 'mixed'];
      fields.push(`gender_preference=$${p++}`);
      vals.push(VALID_GENDERS.includes(gender_preference) ? gender_preference : 'mixed');
    }
    if (move_in_date) { fields.push(`move_in_date=$${p++}`); vals.push(move_in_date); }
    // The edit form edits the poster's BASE price per head (before commission and
    // platform fee). From that base we RE-COMPUTE commission, platform fee and both
    // stored totals with exactly the same maths as POST /api/listings, so an edit
    // can never leave the fee figures stale. `original_price` (legacy room TOTAL)
    // is still accepted and treated as a base-per-person figure derived from it.
    if (price_per_head_in !== undefined && price_per_head_in !== '') {
      const occ = clampOccupancy(occupancy_type || listing.occupancy_type);
      const base = parseFloat(parseFloat(price_per_head_in).toFixed(2));
      if (!Number.isFinite(base) || base <= 0) return res.status(400).json({ error: 'A valid price per person is required' });

      // Poster type + commission are properties of the listing (set at post time),
      // not the edit form — read them from the stored row.
      const kind = listing.poster_type === 'agent' ? 'agent' : 'owner';
      const feeRate = kind === 'agent' ? 0.05 : 0.07;
      const commValue = kind === 'agent' && Number.isFinite(parseFloat(listing.commission_value))
        ? parseFloat(parseFloat(listing.commission_value).toFixed(2))
        : 0;
      const commission = kind === 'agent' ? parseFloat((commValue * occ).toFixed(2)) : 0;
      // Platform fee: agent -> 5% of ((total commission × occupancy) + base per
      // person); owner -> 7% of the base per person. Identical to POST.
      const feeBasePerPerson = kind === 'agent'
        ? parseFloat(((commission * occ) + base).toFixed(2))
        : base;
      const platformFee = parseFloat((feeBasePerPerson * feeRate).toFixed(2));
      const commissionPerPerson = kind === 'agent' ? commValue : 0;
      // Total per person, then the whole room (all occupants).
      const price_per_head = parseFloat((base + commissionPerPerson + platformFee).toFixed(2));
      const price = parseFloat((price_per_head * occ).toFixed(2));

      fields.push(
        `base_price_per_head=$${p++}`, `original_price=$${p++}`, `listed_price=$${p++}`,
        `price_per_head=$${p++}`, `platform_fee=$${p++}`, `platform_fee_rate=$${p++}`
      );
      vals.push(base, price, price, price_per_head, platformFee, feeRate);
    } else if (original_price) {
      // Legacy: a room TOTAL was sent. Treat it as a base-per-person figure.
      const occ = clampOccupancy(occupancy_type || listing.occupancy_type);
      const base = parseFloat((parseFloat(original_price) / occ).toFixed(2));
      if (!Number.isFinite(base) || base <= 0) return res.status(400).json({ error: 'A valid price is required' });
      const kind = listing.poster_type === 'agent' ? 'agent' : 'owner';
      const feeRate = kind === 'agent' ? 0.05 : 0.07;
      const commValue = kind === 'agent' && Number.isFinite(parseFloat(listing.commission_value))
        ? parseFloat(parseFloat(listing.commission_value).toFixed(2))
        : 0;
      const commission = kind === 'agent' ? parseFloat((commValue * occ).toFixed(2)) : 0;
      const feeBasePerPerson = kind === 'agent' ? parseFloat(((commission * occ) + base).toFixed(2)) : base;
      const platformFee = parseFloat((feeBasePerPerson * feeRate).toFixed(2));
      const commissionPerPerson = kind === 'agent' ? commValue : 0;
      const price_per_head = parseFloat((base + commissionPerPerson + platformFee).toFixed(2));
      const price = parseFloat((price_per_head * occ).toFixed(2));
      fields.push(
        `base_price_per_head=$${p++}`, `original_price=$${p++}`, `listed_price=$${p++}`,
        `price_per_head=$${p++}`, `platform_fee=$${p++}`, `platform_fee_rate=$${p++}`
      );
      vals.push(base, price, price, price_per_head, platformFee, feeRate);
    }
    if (occupancy_type && (original_price || (price_per_head_in !== undefined && price_per_head_in !== ''))) { fields.push(`occupancy_type=$${p++}`); vals.push(clampOccupancy(occupancy_type)); }
    // Editing an existing listing must NOT send it back through admin review —
    // an already-approved room stays live. Only new posts (POST /) require review.
    vals.push(req.params.uuid);
    await db.query(`UPDATE listings SET ${fields.join(', ')} WHERE uuid=$${p}`, vals);

    // A REJECTED room that its owner edited is a resubmission: send it back for
    // review and clear the old rejection reason, so it re-enters the queue instead
    // of staying rejected forever. Other statuses are untouched — editing an
    // already-approved room must NOT push it back through review.
    if (listing.status === 'rejected') {
      await db.query("UPDATE listings SET status='pending', rejection_reason=NULL WHERE uuid=$1", [req.params.uuid]);
    }

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

// GET /api/listings/:uuid/edit-data — owner (or an admin) fetches full listing +
// amenities for the edit form. An admin edits ANY listing, so for them the row is
// found by uuid alone — otherwise `listing` would be undefined and building the
// response would throw a 500, blocking admins from the edit form entirely.
router.get('/:uuid/edit-data', requireAuth, async (req, res) => {
  try {
    const lr = req.session.user.role === 'admin'
      ? await db.query('SELECT * FROM listings WHERE uuid=$1', [req.params.uuid])
      : await db.query('SELECT * FROM listings WHERE uuid=$1 AND owner_id=$2', [req.params.uuid, req.session.user.id]);
    const listing = lr.rows[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
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
