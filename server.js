const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
require('./db'); // ensures data file + default admin exist before routes load

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const activityRoutes = require('./routes/activity');
const issueRoutes = require('./routes/issues');
const eventRoutes = require('./routes/events');
const programColorRoutes = require('./routes/programColors');
const boardRoutes = require('./routes/boards');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// A hardcoded fallback secret would be visible to anyone reading this
// public repo, letting them forge session cookies for any deployment that
// forgot to set SESSION_SECRET. A fresh random secret per process boot is
// the safe fallback instead — worst case, existing sessions are dropped
// on restart, not permanently forgeable. deploy/setup.sh already writes a
// real persistent secret to .env, so this path shouldn't be hit in
// practice, but it's here as a safety net rather than a public secret.
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set — using a random secret for this run. Sessions will not survive a restart. Set SESSION_SECRET in .env for production.');
}

// Trust the reverse proxy's X-Forwarded-Proto so express-session's
// cookie.secure:'auto' correctly marks the cookie Secure when served over
// HTTPS via Caddy, without breaking plain-HTTP local development.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Baseline security headers — no extra dependency needed for this small a set.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(session({
  name: 'quickdash.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: 'auto',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    sameSite: 'lax'
  }
}));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/program-colors', programColorRoutes);
app.use('/api/boards', boardRoutes);

// Gate the app shell behind auth; login page and static assets stay open.
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`QuickDash listening on http://localhost:${PORT}`);
});
