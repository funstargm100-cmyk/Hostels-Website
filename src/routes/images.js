// On-demand image thumbnails — the single image source for EVERY card on the
// site (grid, list, map popup, home rails, favourites, poster profile, owner
// manager). Listings store one full-size WebP (up to 1600px); a card is far
// smaller, so shipping the original wastes bandwidth and decode time on every
// card render. Only the listing DETAIL page loads the original.
//
// This endpoint resizes a listing image on FIRST request and caches it in
// memory, so later requests are served straight from memory with a long cache
// header.
//
//   GET /api/img/thumb?src=<image url or /uploads path>&w=512
//
// Security: `src` is only accepted when it points at our own Supabase project
// (matches SUPABASE_URL) or a local /uploads path — never an arbitrary remote URL
// — so this cannot be used as an open image proxy / SSRF vector.
const express = require('express');
const router = express.Router();
const sharp = require('sharp');

// 512 is the shared CARD thumbnail width used across the whole site (see
// CARD_THUMB_WIDTH in public/js/app.js); 256 is the smaller map-popup variant.
const ALLOWED_WIDTHS = [128, 256, 384, 512, 768];
const DEFAULT_WIDTH = 512;
const MAX_SRC_LEN = 2048;

// Small, bounded in-memory cache (keyed by src + width). A handful of MB is
// plenty: this is a read-through cache, and the CDN/browser cache does the
// heavy lifting once each variant has been produced.
const cache = new Map();
// Every card on the site reads through here now, so keep a generous bound.
const CACHE_MAX = 800;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  // Refresh LRU position.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}
function cacheSet(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// Only allow images that belong to us: a Supabase Storage object from OUR
// project, or a local /uploads file. Anything else is rejected.
function isAllowedSource(src) {
  if (!src || typeof src !== 'string' || src.length > MAX_SRC_LEN) return false;
  // Local uploads (dev / self-hosted).
  if (src.startsWith('/uploads/')) return true;
  // Inline data URLs are self-contained and safe to resize.
  if (src.startsWith('data:image/')) return true;
  // Supabase Storage public object URL for our project.
  const supaUrl = process.env.SUPABASE_URL;
  if (supaUrl) {
    try {
      const base = new URL(supaUrl).origin;
      const u = new URL(src);
      if (u.origin === base && u.pathname.includes('/storage/v1/object/public/')) return true;
    } catch { return false; }
  }
  return false;
}

async function fetchSource(src) {
  // Data URLs: decode in place.
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(src);
  if (m) return Buffer.from(m[2], 'base64');
  // Local uploads are read off disk by express.static under /uploads; for the
  // thumbnail we resolve them ourselves.
  if (src.startsWith('/uploads/')) {
    const path = require('path');
    const fs = require('fs');
    const safe = path.basename(src); // strip any traversal
    const file = path.join(__dirname, '..', '..', 'public', 'uploads', safe);
    return fs.promises.readFile(file);
  }
  // Remote (Supabase) — fetch the bytes.
  const res = await fetch(src);
  if (!res.ok) throw new Error(`source returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

router.get('/thumb', async (req, res) => {
  const src = req.query.src;
  const wRaw = parseInt(req.query.w, 10);
  const width = ALLOWED_WIDTHS.includes(wRaw) ? wRaw : DEFAULT_WIDTH;

  if (!isAllowedSource(src)) return res.status(400).json({ error: 'Invalid image source' });

  const key = width + '|' + src;
  const cached = cacheGet(key);
  if (cached) {
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(cached);
  }

  try {
    const input = await fetchSource(src);
    const out = await sharp(input, { failOn: 'none' })
      .rotate()
      // Lanczos3 is the sharpest resampler for downscaling — matters more now
      // that these thumbnails are the ONLY image most pages show.
      .resize({ width, withoutEnlargement: true, kernel: 'lanczos3' })
      .webp({ quality: 78 })
      .toBuffer();
    cacheSet(key, out);
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(out);
  } catch (err) {
    // Never hard-fail a card: tell the client to fall back to the original.
    res.status(404).json({ error: 'Could not generate thumbnail' });
  }
});

module.exports = router;
