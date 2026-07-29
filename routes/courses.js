const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { db, nextId } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const STATUSES = ['not_started', 'in_progress', 'done'];

function logActivity({ userId, username, courseId, courseTitle, action, fromStatus, toStatus, notes }) {
  db.get('activity').push({
    id: nextId('activity'),
    userId,
    username,
    courseId,
    courseTitle,
    action,
    fromStatus: fromStatus || null,
    toStatus: toStatus || null,
    notes: notes || '',
    timestamp: new Date().toISOString()
  }).write();
}

// Old spreadsheet color -> status, so an existing color-coded export maps cleanly.
const COLOR_TO_STATUS = {
  red: 'not_started', 'not started': 'not_started', 'to do': 'not_started', todo: 'not_started',
  yellow: 'in_progress', orange: 'in_progress', amber: 'in_progress', 'in progress': 'in_progress', 'in-progress': 'in_progress',
  green: 'done', complete: 'done', completed: 'done', done: 'done'
};

function normalizeStatus(raw) {
  if (!raw) return 'not_started';
  const key = String(raw).trim().toLowerCase();
  if (STATUSES.includes(key)) return key;
  return COLOR_TO_STATUS[key] || 'not_started';
}

router.get('/', requireAuth, (req, res) => {
  let courses = db.get('courses').value();
  if (req.query.status) {
    const wanted = String(req.query.status).split(',');
    courses = courses.filter(c => wanted.includes(c.status));
  }
  res.json(courses);
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { title, category, notes } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Course title is required' });
  }
  const course = {
    id: nextId('course'),
    title: String(title).trim(),
    category: category ? String(category).trim() : '',
    status: 'not_started',
    assignedTo: null,
    assignedToName: null,
    notes: notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.get('courses').push(course).write();
  res.status(201).json(course);
});

router.post('/import', requireAuth, requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required (field name "file")' });

  let records;
  try {
    records = parse(req.file.buffer.toString('utf8'), {
      columns: header => header.map(h => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true
    });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  const titleKey = ['title', 'course', 'course name', 'course title', 'name'];
  const statusKey = ['status', 'color', 'colour'];
  const categoryKey = ['category', 'department', 'subject'];

  const findValue = (row, candidates) => {
    for (const key of Object.keys(row)) {
      if (candidates.includes(key)) return row[key];
    }
    return '';
  };

  let created = 0;
  const skipped = [];
  for (const row of records) {
    const title = findValue(row, titleKey);
    if (!title || !title.trim()) {
      skipped.push(row);
      continue;
    }
    const course = {
      id: nextId('course'),
      title: title.trim(),
      category: (findValue(row, categoryKey) || '').trim(),
      status: normalizeStatus(findValue(row, statusKey)),
      assignedTo: null,
      assignedToName: null,
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.get('courses').push(course).write();
    created += 1;
  }

  res.json({ created, skipped: skipped.length, totalRows: records.length });
});

router.patch('/:id', requireAuth, (req, res) => {
  const course = db.get('courses').find({ id: Number(req.params.id) }).value();
  if (!course) return res.status(404).json({ error: 'Course not found' });

  const { status, claim, notes } = req.body || {};
  const patch = { updatedAt: new Date().toISOString() };
  const currentUser = db.get('users').find({ id: req.session.userId }).value();

  // Non-admins may only touch courses assigned to them (or claim an unassigned one).
  const isAdmin = req.session.role === 'admin';
  const isOwner = course.assignedTo === req.session.userId;

  if (claim === true) {
    if (course.assignedTo && !isAdmin) {
      return res.status(403).json({ error: 'Course is already claimed by someone else' });
    }
    patch.assignedTo = currentUser.id;
    patch.assignedToName = currentUser.name;
    logActivity({
      userId: currentUser.id, username: currentUser.name,
      courseId: course.id, courseTitle: course.title,
      action: 'claimed', fromStatus: course.status, toStatus: course.status
    });
  }

  if (status) {
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    if (!isAdmin && !isOwner && !claim) {
      return res.status(403).json({ error: 'Claim this course before updating its status' });
    }
    if (status !== course.status) {
      logActivity({
        userId: currentUser.id, username: currentUser.name,
        courseId: course.id, courseTitle: course.title,
        action: 'status_change', fromStatus: course.status, toStatus: status, notes
      });
    }
    patch.status = status;
  }

  if (typeof notes === 'string' && !status) {
    patch.notes = notes;
    logActivity({
      userId: currentUser.id, username: currentUser.name,
      courseId: course.id, courseTitle: course.title,
      action: 'note', notes
    });
  } else if (typeof notes === 'string') {
    patch.notes = notes;
  }

  db.get('courses').find({ id: course.id }).assign(patch).write();
  res.json(db.get('courses').find({ id: course.id }).value());
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const course = db.get('courses').find({ id: Number(req.params.id) }).value();
  if (!course) return res.status(404).json({ error: 'Course not found' });
  db.get('courses').remove({ id: course.id }).write();
  res.json({ ok: true });
});

module.exports = router;
