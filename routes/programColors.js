const express = require('express');
const { db } = require('../db');
const { requireAuth, requireAdmin, requireCoursesAccess } = require('../middleware/auth');
const { broadcast } = require('../events');

const router = express.Router();

const HEX_RE = /^#?[0-9A-Fa-f]{6}$/;

router.get('/', requireAuth, requireCoursesAccess, (req, res) => {
  res.json(db.get('programColors').value());
});

router.put('/:category', requireAuth, requireAdmin, (req, res) => {
  const category = req.params.category.trim();
  const { color } = req.body || {};
  if (!category) return res.status(400).json({ error: 'Category is required' });
  if (!color || !HEX_RE.test(color)) {
    return res.status(400).json({ error: 'Color must be a hex value like #2a78d6' });
  }
  const hex = color.startsWith('#') ? color.toUpperCase() : `#${color.toUpperCase()}`;
  db.set(['programColors', category], hex).write();
  broadcast('programColors');
  res.json({ category, color: hex });
});

router.delete('/:category', requireAuth, requireAdmin, (req, res) => {
  db.unset(['programColors', req.params.category]).write();
  broadcast('programColors');
  res.json({ ok: true });
});

module.exports = router;
