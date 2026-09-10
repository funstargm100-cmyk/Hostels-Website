const jwt = require('jsonwebtoken');
const db = require('../utils/db');
const SECRET = process.env.SESSION_SECRET || 'hostel_secret';

// Checks the DB so suspended OR DELETED users are cut off immediately,
// even if their JWT is still valid.
const checkSuspended = async (req, res) => {
  try {
    const result = await db.query('SELECT is_suspended FROM users WHERE id=$1', [req.user.id]);
    if (!result.rows.length) {
      // Account was deleted — invalidate the session client-side
      res.clearCookie?.('token');
      return res.status(401).json({ error: 'Account no longer exists. Please log in again.', accountDeleted: true });
    }
    if (result.rows[0]?.is_suspended) {
      res.clearCookie?.('token');
      return res.status(403).json({ error: 'Account suspended. Contact support.' });
    }
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
};

const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, SECRET);
    // Keep req.session.user alias so existing route code works unchanged
    req.session = req.session || {};
    req.session.user = req.user;
    await checkSuspended(req, res);
    if (res.headersSent) return;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (...roles) => async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, SECRET);
    req.session = req.session || {};
    req.session.user = req.user;
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    await checkSuspended(req, res);
    if (res.headersSent) return;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { requireAuth, requireRole };
