function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  // req.path is relative to the mount point inside a nested router (e.g.
  // "/HLT" for a request to /api/program-colors/HLT), so it can't reliably
  // tell an API call from a page load — req.originalUrl always has the
  // full request path regardless of nesting.
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not logged in' });
  return res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

module.exports = { requireAuth, requireAdmin };
