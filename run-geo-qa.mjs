import mod from './qa-geo-signup.mjs';
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:3000/signup', { waitUntil: 'networkidle' });
const r = await (mod.default || mod)(p, {});
console.log(JSON.stringify(r, null, 2));
await b.close();
