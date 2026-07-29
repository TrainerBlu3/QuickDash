const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, nextId } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { broadcast } = require('../events');

const router = express.Router();

function generatePassword() {
  // 10 random bytes -> readable base32-ish password, e.g. "K7QF3H9PLM"
  return crypto.randomBytes(8).toString('hex').slice(0, 10);
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
