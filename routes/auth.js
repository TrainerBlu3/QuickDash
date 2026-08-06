const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// In-memory brute-force throttle, keyed by client IP: no external store
// needed for a small internal tool on a single instance. Failed attempts
// within the window count toward the limit; a successful login clears
// them. Resets on process restart, which is an acceptable trade-off here.
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map(); // ip -> { count, windowStart }

function isRateLimited(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: Date.now() });
  } else {
    entry.count += 1;
  }
}

router.post('/login', (req, res) => {
  if (isRateLimited(req.ip)) {
    res.setHeader('Retry-After', String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'Too many login attempts. Try again in a few minutes.' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = db.get('users')
    .find(u => u.username.toLowerCase() === String(username).toLowerCase())
    .value();

  if (!user || !user.active || !bcrypt.compareSync(password, user.passwordHash)) {
    recordFailedAttempt(req.ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  loginAttempts.delete(req.ip);

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
