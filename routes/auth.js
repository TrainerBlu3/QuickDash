const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = db.get('users')
    .find(u => u.username.toLowerCase() === String(username).toLowerCase())
    .value();

  if (!user || !user.active || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;

  res.json({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    mustChangePassword: !!user.mustChangePassword
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('quickdash.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.session.userId }).value();
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  res.json({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    mustChangePassword: !!user.mustChangePassword
  });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = db.get('users').find({ id: req.session.userId }).value();
  if (!user || !bcrypt.compareSync(currentPassword || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.get('users').find({ id: user.id }).assign({
    passwordHash: bcrypt.hashSync(newPassword, 10),
    mustChangePassword: false
  }).write();
  res.json({ ok: true });
});

module.exports = router;
