const express = require('express');
const session = require('express-session');
const path = require('path');
require('./db'); // ensures data file + default admin exist before routes load

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const activityRoutes = require('./routes/activity');
const issueRoutes = require('./routes/issues');
const eventRoutes = require('./routes/events');
const programColorRoutes = require('./routes/programColors');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'quickdash.sid',
  secret: process.env.SESSION_SECRET || 'quickdash-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
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
