import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query("select column_name from information_schema.columns where table_name='users'");
console.log(r.rows.map(x => x.column_name).join(', '));
await c.end();
