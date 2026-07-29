const express = require('express');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function sortedDesc(entries) {
  return [...entries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// Current user's own log.
router.get('/mine', requireAuth, (req, res) => {
  const entries = db.get('activity').filter({ userId: req.session.userId }).value();
  res.json(sortedDesc(entries));
});

// All logs (admin) or logs for one user (admin, or the user themself).
router.get('/', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'admin';
  let entries = db.get('activity').value();

  if (req.query.userId) {
    const userId = Number(req.query.userId);
    if (!isAdmin && userId !== req.session.userId) {
      return res.status(403).json({ error: 'You can only view your own log' });
    }
    entries = entries.filter(e => e.userId === userId);
  } else if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required to view all logs' });
  }

  if (req.query.courseId) {
    entries = entries.filter(e => e.courseId === Number(req.query.courseId));
  }

  res.json(sortedDesc(entries));
});

module.exports = router;
