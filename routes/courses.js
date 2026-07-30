const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const XlsxPopulate = require('xlsx-populate');
const { loadThemeColors, classifyRow } = require('../colorClassify');
const { db, nextId } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { broadcast } = require('../events');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .csv, .xlsx, or .xls files are supported'), ok);
  }
});

// CSV rows carry no color info; xlsx rows do — each row's `color` is the
// classification of whatever fill fires first when scanning across its
// cells (see colorClassify.js), or null for CSV.
async function parseSpreadsheet(buffer, originalName) {
  if (/\.xlsx?$/i.test(originalName || '')) {
    const [workbook, themeColors] = await Promise.all([
      XlsxPopulate.fromDataAsync(buffer),
      loadThemeColors(buffer)
    ]);
    const sheet = workbook.sheet(0);
    const usedRange = sheet.usedRange();
    if (!usedRange) return [];
    const startRow = usedRange.startCell().rowNumber();
    const startColumn = usedRange.startCell().columnNumber();
    const endRow = usedRange.endCell().rowNumber();
    const endColumn = usedRange.endCell().columnNumber();
    const headers = [];
    for (let col = startColumn; col <= endColumn; col++) {
      headers.push(String(sheet.cell(startRow, col).value() ?? '').trim().toLowerCase());
    }
    const rows = [];
    for (let row = startRow + 1; row <= endRow; row++) {
      const fields = {};
      headers.forEach((header, i) => {
        if (!header) return;
        const value = sheet.cell(row, startColumn + i).value();
        fields[header] = value == null ? '' : String(value).trim();
      });
      const color = classifyRow(sheet, row, endColumn, themeColors);
      rows.push({ fields, color });
    }
    return rows;
  }
  const records = parse(buffer.toString('utf8'), {
    columns: header => header.map(h => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true
  });
  return records.map(fields => ({ fields, color: null }));
}

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
  const { title, category, notes, crn } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Course title is required' });
  }
  const course = {
    id: nextId('course'),
    title: String(title).trim(),
    category: category ? String(category).trim() : '',
    crn: crn ? String(crn).trim() : '',
    status: 'not_started',
    priority: false,
    assignedTo: null,
    assignedToName: null,
    notes: notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.get('courses').push(course).write();
  broadcast('courses');
  res.status(201).json(course);
});

router.post('/import', requireAuth, requireAdmin, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'A CSV or Excel file is required (field name "file")' });

    let rows;
    try {
      rows = await parseSpreadsheet(req.file.buffer, req.file.originalname);
    } catch (err) {
      return res.status(400).json({ error: `Could not parse file: ${err.message}` });
    }

    // Optional cutoff (from the preview step) — only parse/import the
    // sheet's first N data rows, e.g. to leave out trailing notes or a
    // second table that isn't actually course data.
    const upTo = Number(req.body.upTo);
    if (Number.isFinite(upTo) && upTo > 0) {
      rows = rows.slice(0, upTo);
    }

    importRecords(rows, res);
  });
});

// Parses the file and reports what each row would resolve to, without
// writing anything — lets the admin see where the real data ends (e.g.
// trailing notes rows) and choose a cutoff before committing to /import.
router.post('/import/preview', requireAuth, requireAdmin, (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'A CSV or Excel file is required (field name "file")' });

    let rows;
    try {
      rows = await parseSpreadsheet(req.file.buffer, req.file.originalname);
    } catch (err) {
      return res.status(400).json({ error: `Could not parse file: ${err.message}` });
    }

    const preview = rows.map((row, i) => ({
      row: i + 1,
      title: deriveTitle(row.fields) || '(missing title — would be skipped)',
      category: (findValue(row.fields, CATEGORY_KEY) || '').trim(),
      crn: (findCrnValue(row.fields) || '').trim()
    }));

    res.json({ totalRows: rows.length, preview });
  });
});

const TITLE_KEY = ['title', 'course', 'course name', 'course title', 'name'];
const STATUS_KEY = ['status', 'color', 'colour'];
const CATEGORY_KEY = ['category', 'department', 'subject', 'program'];
const INSTRUCTOR_KEY = ['instructor', 'faculty', 'teacher'];
const CRN_KEY = ['crn', 'course reference number', 'section'];

function findValue(fields, candidates) {
  for (const key of Object.keys(fields)) {
    if (candidates.includes(key)) return fields[key];
  }
  return '';
}

// CRN column headers vary a lot in the wild ("CRN to be used", "CRN#",
// "Fall CRN", ...) — matching on a "crn" prefix instead of the exact
// header text catches those without needing every phrasing listed.
function findCrnValue(fields) {
  const exact = findValue(fields, CRN_KEY);
  if (exact) return exact;
  for (const key of Object.keys(fields)) {
    if (key.startsWith('crn')) return fields[key];
  }
  return '';
}

function deriveTitle(fields) {
  const baseTitle = findValue(fields, TITLE_KEY);
  if (!baseTitle || !baseTitle.trim()) return '';
  const instructor = findValue(fields, INSTRUCTOR_KEY);
  return instructor && instructor.trim() ? `${baseTitle.trim()} — ${instructor.trim()}` : baseTitle.trim();
}

function importRecords(rows, res) {
  // Match existing courses by title (case-insensitive) so re-importing an
  // updated export only adds new rows and never touches a course's status,
  // priority, assignment, or notes — a claim or in-progress mark always
  // survives a re-import. Category/CRN are the exception: those get
  // backfilled onto an already-existing row if the import has a non-blank
  // value for them, since spreadsheets are commonly re-exported with
  // columns (like CRN) that an earlier import round didn't have yet. When
  // an instructor column is present, it's folded into the title (e.g.
  // "EA 111 — Tanya Fleck") so that a course code repeated across multiple
  // sections is tracked as separate rows instead of being collapsed into one.
  const existingByTitle = new Map(db.get('courses').value().map(c => [c.title.trim().toLowerCase(), c]));

  let created = 0;
  let duplicates = 0;
  let updated = 0;
  let skipped = 0;
  let colorDone = 0;
  let colorPriority = 0;
  for (const row of rows) {
    const { fields, color } = row;
    const title = deriveTitle(fields);
    if (!title) {
      skipped += 1;
      continue;
    }

    const key = title.toLowerCase();
    const existing = existingByTitle.get(key);
    if (existing) {
      duplicates += 1;
      const category = (findValue(fields, CATEGORY_KEY) || '').trim();
      const crn = (findCrnValue(fields) || '').trim();
      const patch = {};
      if (category && category !== existing.category) patch.category = category;
      if (crn && crn !== existing.crn) patch.crn = crn;
      if (Object.keys(patch).length) {
        patch.updatedAt = new Date().toISOString();
        db.get('courses').find({ id: existing.id }).assign(patch).write();
        Object.assign(existing, patch);
        updated += 1;
      }
      continue;
    }

    const explicitStatus = findValue(fields, STATUS_KEY);
    let status = 'not_started';
    let priority = false;
    if (explicitStatus && explicitStatus.trim()) {
      status = normalizeStatus(explicitStatus);
    } else if (color) {
      status = color.done ? 'done' : 'not_started';
      priority = color.priority;
    }
    if (color) {
      if (color.done) colorDone += 1;
      if (color.priority) colorPriority += 1;
    }

    const course = {
      id: nextId('course'),
      title,
      category: (findValue(fields, CATEGORY_KEY) || '').trim(),
      crn: (findCrnValue(fields) || '').trim(),
      status,
      priority,
      assignedTo: null,
      assignedToName: null,
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.get('courses').push(course).write();
    existingByTitle.set(key, course);
    created += 1;
  }

  if (created > 0 || updated > 0) broadcast('courses');
  res.json({
    created,
    duplicates,
    updated,
    skipped,
    totalRows: rows.length,
    colorDetected: rows.some(r => r.color) ? { done: colorDone, priority: colorPriority } : null
  });
}

router.patch('/:id', requireAuth, (req, res) => {
  const course = db.get('courses').find({ id: Number(req.params.id) }).value();
  if (!course) return res.status(404).json({ error: 'Course not found' });

  const { status, claim, unclaim, notes, priority, assignTo } = req.body || {};
  const patch = { updatedAt: new Date().toISOString() };
  const currentUser = db.get('users').find({ id: req.session.userId }).value();

  // Non-admins may only touch courses assigned to them (or claim an unassigned one).
  const isAdmin = req.session.role === 'admin';
  const isOwner = course.assignedTo === req.session.userId;

  if (typeof priority === 'boolean') {
    if (!isAdmin) return res.status(403).json({ error: 'Only admins can change priority' });
    patch.priority = priority;
  }

  // Admin directly assigning (or unassigning) a course to/from a specific
  // user, as opposed to a user claiming it for themselves.
  if (typeof assignTo !== 'undefined') {
    if (!isAdmin) return res.status(403).json({ error: 'Only admins can assign courses to a user' });
    if (assignTo === null) {
      if (course.assignedTo) {
        const previousName = course.assignedToName;
        patch.assignedTo = null;
        patch.assignedToName = null;
        logActivity({
          userId: currentUser.id, username: currentUser.name,
          courseId: course.id, courseTitle: course.title,
          action: 'unclaimed', fromStatus: course.status, toStatus: course.status,
          notes: `Unassigned by admin (was ${previousName})`
        });
      }
    } else {
      const target = db.get('users').find({ id: Number(assignTo) }).value();
      if (!target) return res.status(400).json({ error: 'User not found' });
      if (course.assignedTo !== target.id) {
        patch.assignedTo = target.id;
        patch.assignedToName = target.name;
        logActivity({
          userId: currentUser.id, username: currentUser.name,
          courseId: course.id, courseTitle: course.title,
          action: 'assigned', fromStatus: course.status, toStatus: course.status,
          notes: `Assigned to ${target.name} by admin`
        });
      }
    }
  }

  if (unclaim === true) {
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Only the assignee or an admin can release this claim' });
    }
    if (course.assignedTo) {
      const previousName = course.assignedToName;
      patch.assignedTo = null;
      patch.assignedToName = null;
      logActivity({
        userId: currentUser.id, username: currentUser.name,
        courseId: course.id, courseTitle: course.title,
        action: 'unclaimed', fromStatus: course.status, toStatus: course.status,
        notes: isAdmin && !isOwner ? `Released by admin (was claimed by ${previousName})` : notes
      });
    }
  }

  if (claim === true) {
    if (course.assignedTo && course.assignedTo !== req.session.userId && !isAdmin) {
      return res.status(403).json({ error: 'Course is already claimed by someone else' });
    }
    if (course.assignedTo !== currentUser.id) {
      patch.assignedTo = currentUser.id;
      patch.assignedToName = currentUser.name;
      logActivity({
        userId: currentUser.id, username: currentUser.name,
        courseId: course.id, courseTitle: course.title,
        action: 'claimed', fromStatus: course.status, toStatus: course.status
      });
    }
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
  broadcast(['courses', 'activity']);
  res.json(db.get('courses').find({ id: course.id }).value());
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  const course = db.get('courses').find({ id: Number(req.params.id) }).value();
  if (!course) return res.status(404).json({ error: 'Course not found' });
  db.get('courses').remove({ id: course.id }).write();
  broadcast('courses');
  res.json({ ok: true });
});

module.exports = router;
