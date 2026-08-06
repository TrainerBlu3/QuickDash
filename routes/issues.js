const express = require('express');
const { db, nextId } = require('../db');
const { requireAuth, requireAdmin, requireCoursesAccess } = require('../middleware/auth');
const { broadcast } = require('../events');

const router = express.Router();

const STATUSES = ['open', 'resolved'];

function logActivity({ userId, username, courseId, courseTitle, action, notes }) {
  db.get('activity').push({
    id: nextId('activity'),
    userId,
    username,
    courseId,
    courseTitle,
    action,
    fromStatus: null,
    toStatus: null,
    notes: notes || '',
    timestamp: new Date().toISOString()
  }).write();
}

router.get('/', requireAuth, requireCoursesAccess, (req, res) => {
  let issues = db.get('issues').value();
  if (req.query.courseId) issues = issues.filter(i => i.courseId === Number(req.query.courseId));
  if (req.query.status) issues = issues.filter(i => i.status === req.query.status);
  issues = [...issues].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(issues);
});

// Any signed-in user can flag a problem with a course — not just its
// current assignee — since the point is that everyone else sees it too,
// including after the reporter has already handed the course back.
router.post('/', requireAuth, requireCoursesAccess, (req, res) => {
  const { courseId, description } = req.body || {};
  const course = db.get('courses').find({ id: Number(courseId) }).value();
  if (!course) return res.status(400).json({ error: 'Course not found' });
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'A description of the issue is required' });
  }

  const currentUser = db.get('users').find({ id: req.session.userId }).value();
  const issue = {
    id: nextId('issue'),
    courseId: course.id,
    courseTitle: course.title,
    description: String(description).trim(),
    status: 'open',
    reportedBy: currentUser.id,
    reportedByName: currentUser.name,
    resolvedBy: null,
    resolvedByName: null,
    resolvedAt: null,
    resolutionNotes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.get('issues').push(issue).write();
  logActivity({
    userId: currentUser.id, username: currentUser.name,
    courseId: course.id, courseTitle: course.title,
    action: 'issue_reported', notes: issue.description
  });
  broadcast(['issues', 'activity']);
  res.status(201).json(issue);
});

router.patch('/:id', requireAuth, requireCoursesAccess, requireAdmin, (req, res) => {
  const issue = db.get('issues').find({ id: Number(req.params.id) }).value();
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const { status, description, resolutionNotes } = req.body || {};
  const currentUser = db.get('users').find({ id: req.session.userId }).value();
  const patch = { updatedAt: new Date().toISOString() };

  if (typeof description === 'string') {
    if (!description.trim()) return res.status(400).json({ error: 'Description cannot be empty' });
    patch.description = description.trim();
  }

  if (typeof resolutionNotes === 'string') {
    patch.resolutionNotes = resolutionNotes.trim();
  }

  if (status) {
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });
    }
    if (status !== issue.status) {
      if (status === 'resolved') {
        patch.resolvedBy = currentUser.id;
        patch.resolvedByName = currentUser.name;
        patch.resolvedAt = new Date().toISOString();
      } else {
        patch.resolvedBy = null;
        patch.resolvedByName = null;
        patch.resolvedAt = null;
      }
      logActivity({
        userId: currentUser.id, username: currentUser.name,
        courseId: issue.courseId, courseTitle: issue.courseTitle,
        action: status === 'resolved' ? 'issue_resolved' : 'issue_reopened',
        notes: patch.resolutionNotes ?? issue.resolutionNotes
      });
    }
    patch.status = status;
  }

  db.get('issues').find({ id: issue.id }).assign(patch).write();
  broadcast(['issues', 'activity']);
  res.json(db.get('issues').find({ id: issue.id }).value());
});

router.delete('/:id', requireAuth, requireCoursesAccess, requireAdmin, (req, res) => {
  const issue = db.get('issues').find({ id: Number(req.params.id) }).value();
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const currentUser = db.get('users').find({ id: req.session.userId }).value();
  db.get('issues').remove({ id: issue.id }).write();
  logActivity({
    userId: currentUser.id, username: currentUser.name,
    courseId: issue.courseId, courseTitle: issue.courseTitle,
    action: 'issue_removed', notes: issue.description
  });
  broadcast(['issues', 'activity']);
  res.json({ ok: true });
});

module.exports = router;
