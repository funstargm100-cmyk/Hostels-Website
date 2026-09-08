// Image processing + storage: convert uploads to WebP via sharp, store in
// Supabase Storage (or local disk in dev). Falls back to compressed WebP
// data URLs if no bucket is configured, so existing DB rows keep working.
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

let supabase = null;
function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(url, key);
    return supabase;
  } catch (err) {
    console.error('Supabase init failed:', err.message);
    return null;
  }
}

const BUCKET = process.env.SUPABASE_BUCKET || 'listing-images';

// Convert any upload (jpeg/png/webp/heic where supported) to a compact WebP.
// Returns { buffer, contentType, width, height }
async function toWebp(buffer, maxDim = 1600, quality = 72) {
  let img = sharp(buffer, { failOn: 'none' }).rotate(); // honour EXIF orientation
  const meta = await img.metadata();
  if (meta.width > maxDim || meta.height > maxDim) {
    img = img.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true });
  }
  const out = await img.webp({ quality }).toBuffer();
  const outMeta = await sharp(out).metadata();
  return { buffer: out, contentType: 'image/webp', width: outMeta.width, height: outMeta.height };
}

// Upload a WebP buffer. Returns the path/URL to store in listing_images.image_path.
// Order of preference:
//   1. Supabase Storage (public URL)   — works on Vercel and locally
//   2. Local disk public/uploads       — dev only
//   3. Inline WebP data URL            — last resort, still ~40% smaller than JPEG b64
async function storeImage(buffer, originalName) {
  const { buffer: webpBuf, contentType } = await toWebp(buffer);
  const base = path.basename(originalName, path.extname(originalName))
    .replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 60) || 'img';
  const objectName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.webp`;

  const client = getSupabase();
  if (client) {
    const { error } = await client.storage.from(BUCKET).upload(objectName, webpBuf, {
      contentType,
      upsert: false,
      cacheControl: '31536000'
    });
    if (!error) {
      const { data } = client.storage.from(BUCKET).getPublicUrl(objectName);
      return data.publicUrl;
    }
    console.error('Supabase upload failed, falling back:', error.message);
  }

  // Local disk (development)
  if (process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1') {
    try {
      const dir = path.join(__dirname, '..', '..', 'public', 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, objectName), webpBuf);
      return `/uploads/${objectName}`;
    } catch (err) {
      console.error('Local upload failed, falling back to data URL:', err.message);
    }
  }

  // Last resort: inline data URL (still much smaller than the raw upload)
  return `data:${contentType};base64,${webpBuf.toString('base64')}`;
}

module.exports = { toWebp, storeImage, BUCKET };
