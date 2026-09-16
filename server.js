require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the proxy (Vercel/Heroku/nginx) so req.ip resolves from X-Forwarded-For.
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// on every proxied request, killing uploads before they reach multer.
app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  // Always revalidate JS/CSS so phones pick up new code immediately
  setHeaders: (res) => res.set('Cache-Control', 'no-cache')
}));

// Stub req.session so route files that reference req.session.user still work
app.use((req, res, next) => {
  req.session = { user: null };
  next();
});

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many attempts, try again later.' } });
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/listings', require('./src/routes/listings'));
app.use('/api/requests', require('./src/routes/requests'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/user', require('./src/routes/user'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/geo', require('./src/routes/geo'));
app.use('/api/payments', require('./src/routes/payments'));
app.use('/api/img', require('./src/routes/images'));

// Serve frontend pages. HTML is marked no-cache so phones always fetch the
// latest markup (and therefore the latest cache-busted JS URLs) instead of
// replaying a stale copy from the browser cache.
const pages = ['', 'listings', 'listing', 'post-ad', 'edit-listing', 'login', 'signup', 'reset-password', 'dashboard', 'admin', 'about', 'contact', 'seekers', 'agents', 'poster-profile'];
const sendNoCache = (res, file) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', file));
};
pages.forEach(page => {
  const route = page ? `/${page}` : '/';
  const file = page ? `${page}.html` : 'index.html';
  app.get(route, (req, res) => sendNoCache(res, file));
});

// Role-tailored home pages (served as real files — no JS view switching).
// The visitor home IS the site root ('/' -> index.html); only the seeker and
// agent homes are separate files, and logged-in roles are redirected to them
// client-side (see public/js/home.js).
app.get('/home-visitor', (req, res) => res.redirect(301, '/'));
app.get('/home-seeker', (req, res) => sendNoCache(res, 'home-seeker.html'));
app.get('/home-agent', (req, res) => sendNoCache(res, 'home-agent.html'));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error('UNHANDLED ERROR:', err.message);
  res.status(500).json({ error: err.message || 'Server error' });
});

// Apply additive schema migrations BEFORE serving traffic, so a deployed database
// that predates a column is brought up to date on boot. A ledger + advisory lock
// make this a no-op on steady-state cold starts and safe across concurrent
// instances (see src/utils/migrate.js). runMigrations() never throws — a failure is
// logged and startup continues.
const { runMigrations } = require('./src/utils/migrate');
runMigrations().finally(() => {
  app.listen(PORT, () => console.log(`Hostels Marketplace running on http://localhost:${PORT}`));
});
