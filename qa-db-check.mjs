import fs from 'fs';
import pg from 'pg';
const env = fs.readFileSync('.env', 'utf8').match(/DATABASE_URL=(.*)/)[1].trim().replace(/^"|"$/g, '');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || env });
const u = await pool.query("SELECT email, base_location, base_lat, base_lng FROM users WHERE role='seeker' AND (base_lat IS NOT NULL OR base_location IS NOT NULL) LIMIT 3");
console.log('SEEKERS WITH BASE:', JSON.stringify(u.rows, null, 1));
const l = await pool.query("SELECT count(*) FILTER (WHERE location_lat IS NOT NULL) AS with_coords, count(*) AS total FROM listings WHERE status='active'");
console.log('LISTINGS:', JSON.stringify(l.rows[0]));
await pool.end();
