import mod from './qa-map-verify.mjs';
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', m => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });
await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
const r = await (mod.default || mod)(p, {});
console.log(JSON.stringify(r, null, 2));
await b.close();
