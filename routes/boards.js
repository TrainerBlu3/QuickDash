const express = require('express');
const { db, nextId } = require('../db');
const { requireAuth, requireAdmin, requireBoardMember } = require('../middleware/auth');
const { broadcast } = require('../events');

const router = express.Router();

function publicBoard(b) {
  return {
    id: b.id,
    name: b.name,
    itemLabel: b.itemLabel,
    fields: b.fields,
    statuses: b.statuses,
    claimTargetStatus: b.claimTargetStatus || null
  };
}

function logActivity({ userId, username, boardId, itemId, itemTitle, action, fromStatus, toStatus, notes }) {
  db.get('activity').push({
    id: nextId('activity'),
    userId,
    username,
    boardId,
    itemId,
    itemTitle,
    action,
    fromStatus: fromStatus || null,
    toStatus: toStatus || null,
    notes: notes || '',
    timestamp: new Date().toISOString()
  }).write();
}

router.get('/', requireAuth, (req, res) => {
  const boards = db.get('boards').value();
  if (req.session.role === 'admin') return res.json(boards.map(publicBoard));

  const memberBoardIds = new Set(
    db.get('boardMembers').filter({ userId: req.session.userId }).map('boardId').value()
  );
  res.json(boards.filter(b => memberBoardIds.has(b.id)).map(publicBoard));
});

router.get('/:boardId', requireAuth, requireBoardMember, (req, res) => {
  res.json(publicBoard(req.board));
});

// Generic board creation — not wired to any UI yet, exists so a future
// third board type doesn't need another backend change.
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { name, itemLabel, fields, statuses, claimTargetStatus } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Board name is required' });
  }
  if (!Array.isArray(statuses) || !statuses.length) {
    return res.status(400).json({ error: 'statuses must be a non-empty array' });
  }
  const board = {
    id: nextId('board'),
    name: String(name).trim(),
    itemLabel: itemLabel ? String(itemLabel).trim() : 'item',
    fields: Array.isArray(fields) ? fields : [],
    statuses,
    claimTargetStatus: claimTargetStatus || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.get('boards').push(board).write();
  broadcast('boards');
  res.status(201).json(publicBoard(board));
});

router.get('/:boardId/members', requireAuth, requireAdmin, (req, res) => {
  const boardId = Number(req.params.boardId);
  const board = db.get('boards').find({ id: boardId }).value();
  if (!board) return res.status(404).json({ error: 'Board not found' });

  const members = db.get('boardMembers').filter({ boardId }).value();
  const users = db.get('users').value();
  res.json(members.map(m => {
    const u = users.find(u => u.id === m.userId);
    return { userId: m.userId, name: u ? u.name : 'Unknown user', username: u ? u.username : null };
  }));
});

router.post('/:boardId/members', requireAuth, requireAdmin, (req, res) => {
  const boardId = Number(req.params.boardId);
  const board = db.get('boards').find({ id: boardId }).value();
  if (!board) return res.status(404).json({ error: 'Board not found' });

  const userId = Number((req.body || {}).userId);
  const user = db.get('users').find({ id: userId }).value();
  if (!user) return res.status(400).json({ error: 'User not found' });

  const existing = db.get('boardMembers').find({ boardId, userId }).value();
  if (!existing) {
    db.get('boardMembers').push({ boardId, userId }).write();
    broadcast('boardMembers');
  }
  res.status(201).json({ userId, name: user.name, username: user.username });
});

router.delete('/:boardId/members/:userId', requireAuth, requireAdmin, (req, res) => {
  const boardId = Number(req.params.boardId);
  const userId = Number(req.params.userId);
  db.get('boardMembers').remove({ boardId, userId }).write();
  broadcast('boardMembers');
  res.json({ ok: true });
});

router.get('/:boardId/items', requireAuth, requireBoardMember, (req, res) => {
  let items = db.get('items').filter({ boardId: req.board.id }).value();
  if (req.query.status) {
    const wanted = String(req.query.status).split(',');
    items = items.filter(i => wanted.includes(i.status));
  }
  res.json(items);
});

router.post('/:boardId/items', requireAuth, requireBoardMember, (req, res) => {
  const { title, notes } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const currentUser = db.get('users').find({ id: req.session.userId }).value();
  const fields = {};
  req.board.fields.forEach(f => {
    const raw = (req.body.fields || {})[f.key];
    fields[f.key] = raw == null ? '' : String(raw).trim();
  });

  const item = {
    id: nextId('item'),
    boardId: req.board.id,
    title: String(title).trim(),
    fields,
    status: req.board.statuses[0],
    assignedTo: null,
    assignedToName: null,
    notes: notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
  db.get('items').push(item).write();
  logActivity({
    userId: currentUser.id, username: currentUser.name,
    boardId: req.board.id, itemId: item.id, itemTitle: item.title,
    action: 'created'
  });
  broadcast([`items:${req.board.id}`, 'activity']);
  res.status(201).json(item);
});

router.patch('/:boardId/items/:itemId', requireAuth, requireBoardMember, (req, res) => {
  const item = db.get('items').find({ id: Number(req.params.itemId), boardId: req.board.id }).value();
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const board = req.board;
  const statuses = board.statuses;
  const terminalStatus = statuses[statuses.length - 1];
  const initialStatus = statuses[0];

  const { status, claim, unclaim, notes, assignTo, title, fields, createdAt, completedAt } = req.body || {};
  const patch = { updatedAt: new Date().toISOString() };
  const currentUser = db.get('users').find({ id: req.session.userId }).value();

  const isAdmin = req.session.role === 'admin';
  const isOwner = item.assignedTo === req.session.userId;

  if (typeof title === 'string' || (fields && typeof fields === 'object') || typeof createdAt !== 'undefined' || typeof completedAt !== 'undefined') {
    if (!isAdmin) return res.status(403).json({ error: 'Only admins can edit this ' + board.itemLabel });
    if (typeof title === 'string') {
      if (!title.trim()) return res.status(400).json({ error: 'Title cannot be empty' });
      patch.title = title.trim();
    }
    if (fields && typeof fields === 'object') {
      const nextFields = { ...item.fields };
      board.fields.forEach(f => {
        if (Object.prototype.hasOwnProperty.call(fields, f.key)) {
          nextFields[f.key] = fields[f.key] == null ? '' : String(fields[f.key]).trim();
        }
      });
      patch.fields = nextFields;
    }
    if (typeof createdAt !== 'undefined') {
      const parsed = new Date(createdAt);
      if (!createdAt || isNaN(parsed)) return res.status(400).json({ error: 'Invalid logged date' });
      patch.createdAt = parsed.toISOString();
    }
    if (typeof completedAt !== 'undefined') {
      if (!completedAt) {
        patch.completedAt = null;
      } else {
        const parsed = new Date(completedAt);
        if (isNaN(parsed)) return res.status(400).json({ error: 'Invalid finished date' });
        patch.completedAt = parsed.toISOString();
      }
    }
    logActivity({
      userId: currentUser.id, username: currentUser.name,
      boardId: board.id, itemId: item.id, itemTitle: patch.title || item.title,
      action: 'edited'
    });
  }

  if (typeof assignTo !== 'undefined') {
    if (!isAdmin) return res.status(403).json({ error: 'Only admins can assign items to a user' });
    if (assignTo === null) {
      if (item.assignedTo) {
        const previousName = item.assignedToName;
        patch.assignedTo = null;
        patch.assignedToName = null;
        logActivity({
          userId: currentUser.id, username: currentUser.name,
          boardId: board.id, itemId: item.id, itemTitle: item.title,
          action: 'unclaimed', fromStatus: item.status, toStatus: item.status,
          notes: `Unassigned by admin (was ${previousName})`
        });
      }
    } else {
      const target = db.get('users').find({ id: Number(assignTo) }).value();
      if (!target) return res.status(400).json({ error: 'User not found' });
      if (item.assignedTo !== target.id) {
        patch.assignedTo = target.id;
        patch.assignedToName = target.name;
        logActivity({
          userId: currentUser.id, username: currentUser.name,
          boardId: board.id, itemId: item.id, itemTitle: item.title,
          action: 'assigned', fromStatus: item.status, toStatus: item.status,
          notes: `Assigned to ${target.name} by admin`
        });
      }
    }
  }

  if (unclaim === true) {
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Only the assignee or an admin can release this claim' });
    }
    if (item.status === terminalStatus) {
      return res.status(400).json({ error: 'Cannot unclaim once resolved' });
    }
    if (item.assignedTo) {
      const previousName = item.assignedToName;
      patch.assignedTo = null;
      patch.assignedToName = null;
      if (board.claimTargetStatus && item.status === board.claimTargetStatus) {
        patch.status = initialStatus;
      }
      logActivity({
        userId: currentUser.id, username: currentUser.name,
        boardId: board.id, itemId: item.id, itemTitle: item.title,
        action: 'unclaimed', fromStatus: item.status, toStatus: patch.status || item.status,
        notes: isAdmin && !isOwner ? `Released by admin (was claimed by ${previousName})` : notes
      });
    }
  }

  if (claim === true) {
    if (item.assignedTo && item.assignedTo !== req.session.userId && !isAdmin) {
      return res.status(403).json({ error: `This ${board.itemLabel} is already claimed by someone else` });
    }
    if (item.assignedTo !== currentUser.id) {
      patch.assignedTo = currentUser.id;
      patch.assignedToName = currentUser.name;
      if (board.claimTargetStatus && item.status === initialStatus) {
        patch.status = board.claimTargetStatus;
      }
      logActivity({
        userId: currentUser.id, username: currentUser.name,
        boardId: board.id, itemId: item.id, itemTitle: item.title,
        action: 'claimed', fromStatus: item.status, toStatus: patch.status || item.status
      });
    }
  }

  if (status) {
    if (!statuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${statuses.join(', ')}` });
    }
    if (!isAdmin && !isOwner && !claim) {
      return res.status(403).json({ error: `Claim this ${board.itemLabel} before updating its status` });
    }
    if (status !== item.status) {
      logActivity({
        userId: currentUser.id, username: currentUser.name,
        boardId: board.id, itemId: item.id, itemTitle: item.title,
        action: 'status_change', fromStatus: item.status, toStatus: status, notes
      });
    }
    patch.status = status;
    patch.completedAt = status === terminalStatus ? new Date().toISOString() : null;
  }

  if (typeof notes === 'string' && !status) {
    patch.notes = notes;
    logActivity({
      userId: currentUser.id, username: currentUser.name,
      boardId: board.id, itemId: item.id, itemTitle: item.title,
      action: 'note', notes
    });
  } else if (typeof notes === 'string') {
    patch.notes = notes;
  }

  db.get('items').find({ id: item.id }).assign(patch).write();
  broadcast([`items:${board.id}`, 'activity']);
  res.json(db.get('items').find({ id: item.id }).value());
});

router.delete('/:boardId/items/:itemId', requireAuth, requireAdmin, (req, res) => {
  const item = db.get('items').find({ id: Number(req.params.itemId), boardId: Number(req.params.boardId) }).value();
  if (!item) return res.status(404).json({ error: 'Item not found' });
  db.get('items').remove({ id: item.id }).write();
  broadcast([`items:${req.params.boardId}`, 'activity']);
  res.json({ ok: true });
});

module.exports = router;
