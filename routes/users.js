const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, nextId } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { broadcast } = require('../events');

const router = express.Router();

function generatePassword() {
  // 16 random bytes -> 32 hex chars (128 bits of entropy). Single-use and
  // forced-change on first login, but no reason to leave it weaker than
  // the change-password minimum by using a truncated slice.
  return crypto.randomBytes(16).toString('hex');
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
    mustChangePassword: !!u.mustChangePassword
  };
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  res.json(db.get('users').map(publicUser).value());
});

// Minimal, non-admin-only listing (id + name of active users) for filter
// and assignment dropdowns that any logged-in user needs, not just admins.
router.get('/list', requireAuth, (req, res) => {
  res.json(db.get('users').filter({ active: true }).map(u => ({ id: u.id, name: u.name })).value());
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { username, name, role } = req.body || {};
  if (!username || !name) {
    return res.status(400).json({ error: 'Username and name are required' });
  }
  const clean = String(username).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(clean)) {
    return res.status(400).json({ error: 'Username must be 3-32 chars: letters, numbers, . _ -' });
  }
  if (db.get('users').find(u => u.username.toLowerCase() === clean).value()) {
    return res.status(409).json({ error: 'That username is already taken' });
  }
  const tempPassword = generatePassword();
  const user = {
    id: nextId('user'),
    username: clean,
    name: String(name).trim(),
    role: role === 'admin' ? 'admin' : 'user',
    passwordHash: bcrypt.hashSync(tempPassword, 10),
    mustChangePassword: true,
    active: true,
    createdAt: new Date().toISOString()
  };
  db.get('users').push(user).write();
  broadcast('users');
  // Temp password is only ever returned here, at creation time, so the
  // admin can hand it to the new user. It is never retrievable again.
  res.status(201).json({ ...publicUser(user), tempPassword });
});

router.post('/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const user = db.get('users').find({ id: Number(req.params.id) }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const tempPassword = generatePassword();
  db.get('users').find({ id: user.id }).assign({
    passwordHash: bcrypt.hashSync(tempPassword, 10),
    mustChangePassword: true
  }).write();
  res.json({ ...publicUser(user), tempPassword });
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const user = db.get('users').find({ id: Number(req.params.id) }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const patch = {};
  if (typeof req.body.active === 'boolean') patch.active = req.body.active;
  if (req.body.role === 'admin' || req.body.role === 'user') patch.role = req.body.role;
  if (req.body.name) patch.name = String(req.body.name).trim();
  db.get('users').find({ id: user.id }).assign(patch).write();
  broadcast('users');
  res.json(publicUser(db.get('users').find({ id: user.id }).value()));
});

module.exports = router;
