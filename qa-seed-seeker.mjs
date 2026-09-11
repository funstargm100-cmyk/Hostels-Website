import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const hash = await bcrypt.hash('password123', 10);
const ex = await c.query('SELECT id FROM users WHERE email=$1', ['seeker@test.com']);
let res;
if (ex.rows.length) {
  res = await c.query(
    'UPDATE users SET password_hash=$1, role=\'seeker\', is_verified=true, base_location=\'Sunyani, Bono Region, Ghana\', base_lat=7.3470, base_lng=-2.3417 WHERE email=$2 RETURNING id, email, role',
    [hash, 'seeker@test.com']
  );
} else {
  res = await c.query(
    `INSERT INTO users (name, email, phone, password_hash, role, is_verified, base_location, base_lat, base_lng)
     VALUES ($1,$2,$3,$4,'seeker',true,'Sunyani, Bono Region, Ghana',7.3470,-2.3417)
     RETURNING id, email, role`,
    ['Test Seeker', 'seeker@test.com', '9800000000', hash]
  );
}
console.log('Seeker ready:', res.rows[0]);
await c.end();
