// Boots the server on an isolated port, exercises the reset endpoints, then exits.
import { spawn } from 'node:child_process';

const PORT = 3999;
const base = `http://localhost:${PORT}`;

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const out = {};
  // wait for boot
  for (let i = 0; i < 20; i++) {
    await wait(400);
    try { await fetch(base + '/'); break; } catch { }
  }

  const jpost = (path, body) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });

  try {
    const r = await fetch(base + '/reset-password'); out.resetPageStatus = r.status;
    out.resetPageHasForm = (await r.text()).includes('resetForm');
  }
  catch (e) { out.resetPageError = e.message; }

  try {
    const r = await jpost('/api/auth/forgot-password', { email: 'nobody@example.com' });
    out.forgotUnknownStatus = r.status; out.forgotUnknownBody = await r.json();
  }
  catch (e) { out.forgotUnknownError = e.message; }

  try {
    const r = await jpost('/api/auth/forgot-password', { email: 'not-an-email' });
    out.forgotInvalidStatus = r.status; out.forgotInvalidBody = await r.json();
  }
  catch (e) { out.forgotInvalidError = e.message; }

  try {
    const r = await jpost('/api/auth/reset-password', { password: 'newpassword' });
    out.resetNoTokenStatus = r.status; out.resetNoTokenBody = await r.json();
  }
  catch (e) { out.resetNoTokenError = e.message; }

  try {
    const r = await jpost('/api/auth/reset-password', { token: 'bogus-token-xyz', password: 'newpassword' });
    out.resetBadTokenStatus = r.status; out.resetBadTokenBody = await r.json();
  }
  catch (e) { out.resetBadTokenError = e.message; }

  out.serverLog = serverLog.trim().split('\n').slice(0, 8);
  console.log(JSON.stringify(out, null, 2));
  server.kill();
  process.exit(0);
}

main();
