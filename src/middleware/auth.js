const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Authentication required' });
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Authentication required' });
  if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Access denied' });
  next();
};

module.exports = { requireAuth, requireRole };
