const jwt = require('jsonwebtoken');
const SECRET = process.env.SESSION_SECRET || 'hostel_secret';

const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, SECRET);
    // Keep req.session.user alias so existing route code works unchanged
    req.session = req.session || {};
    req.session.user = req.user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, SECRET);
    req.session = req.session || {};
    req.session.user = req.user;
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { requireAuth, requireRole };
