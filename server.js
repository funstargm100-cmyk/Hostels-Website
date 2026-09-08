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
app.use(express.static(path.join(__dirname, 'public')));

// Stub req.session so route files that reference req.session.user still work
app.use((req, res, next) => {
  req.session = { user: null };
  next();
});

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts, try again later.' } });
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

// API Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/listings', require('./src/routes/listings'));
app.use('/api/requests', require('./src/routes/requests'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/user', require('./src/routes/user'));
app.use('/api/payments', require('./src/routes/payments'));

// Serve frontend pages
const pages = ['', 'listings', 'listing', 'post-ad', 'login', 'signup', 'dashboard', 'admin', 'about', 'contact'];
pages.forEach(page => {
  const route = page ? `/${page}` : '/';
  const file = page ? `${page}.html` : 'index.html';
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error('UNHANDLED ERROR:', err.message);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => console.log(`Hostels Marketplace running on http://localhost:${PORT}`));
