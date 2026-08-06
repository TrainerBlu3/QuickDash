const { db } = require('../db');

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

function requireBoardMember(req, res, next) {
  const boardId = Number(req.params.boardId);
  const board = db.get('boards').find({ id: boardId }).value();
  if (!board) return res.status(404).json({ error: 'Board not found' });

  const isAdmin = req.session && req.session.role === 'admin';
  const isMember = isAdmin || !!db.get('boardMembers')
    .find({ boardId, userId: req.session.userId }).value();
  if (!isMember) return res.status(403).json({ error: 'Not a member of this board' });

  req.board = board;
  next();
}

module.exports = { requireAuth, requireAdmin, requireBoardMember };
