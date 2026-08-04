const path = require('path');
const fs = require('fs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const adapter = new FileSync(path.join(dataDir, 'db.json'));
const db = low(adapter);

db.defaults({
  users: [],
  courses: [],
  activity: [],
  issues: [],
  programColors: {}, // category/program name -> hex brand color
  nextIds: { user: 1, course: 1, activity: 1, issue: 1 }
}).write();

function nextId(kind) {
  // Falls back to 1 for a kind added after a db.json already existed, since
  // lowdb's .defaults() only fills missing top-level keys, not ones nested
  // inside an object (like nextIds) that's already present.
  const id = db.get(`nextIds.${kind}`).value() || 1;
  db.set(`nextIds.${kind}`, id + 1).write();
  return id;
}

// Seed a default admin account on first run so there's always a way in.
if (db.get('users').size().value() === 0) {
  const seedPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const admin = {
    id: nextId('user'),
    username: 'admin',
    name: 'Administrator',
    role: 'admin',
    passwordHash: bcrypt.hashSync(seedPassword, 10),
    mustChangePassword: true,
    active: true,
    createdAt: new Date().toISOString()
  };
  db.get('users').push(admin).write();
  console.log('============================================================');
  console.log(' No users found — created a default admin account:');
  console.log(`   username: admin`);
  console.log(`   password: ${seedPassword}`);
  console.log(' Log in and create real user accounts, then change this password.');
  console.log('============================================================');
}

module.exports = { db, nextId };
