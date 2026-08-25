let me = null;
let programColors = {};
let allUsers = [];
let issuesDialog = null;
let defaultUserFilterApplied = false;
const columnSort = createColumnSort(() => loadCourses());

let boards = [];
let currentBoardId = 'courses'; // 'courses' or a board.id
const boardViews = {}; // board.id -> { refresh() }, lazily initialized

// The Courses tab is gated on real membership of the legacy "Courses"
// board (itemLabel 'course'), same as any other board — GET /api/boards
// only returns boards this user is a member of (or all of them, for an
// admin), so its presence/absence in the response is the membership
// check. An admin removing everyone from Courses' boardMembers (via the
// Boards admin tab) hides the tab and its data for those users, without
// touching /api/courses itself — admins keep full access regardless.
async function loadBoards() {
  const allBoards = await api('/api/boards');
  const isCoursesMember = allBoards.some(b => b.itemLabel === 'course');
  boards = allBoards.filter(b => b.itemLabel !== 'course');

  const tabsEl = document.getElementById('board-tabs');
  const tabs = [
    ...(isCoursesMember ? [{ id: 'courses', name: 'Courses' }] : []),
    ...boards.map(b => ({ id: b.id, name: b.name }))
  ];

  if (!tabs.length) {
    tabsEl.style.display = 'none';
    document.getElementById('board-courses').style.display = 'none';
    document.getElementById('board-generic').style.display = 'none';
    document.getElementById('board-none').style.display = 'block';
    return;
  }
  document.getElementById('board-none').style.display = 'none';

  // If the current view is no longer available to this user (e.g. their
  // Courses access was just revoked while they were on that tab), fall
  // back to the first tab they do have.
  if (!tabs.some(t => String(t.id) === String(currentBoardId))) {
    currentBoardId = tabs[0].id;
  }

  tabsEl.style.display = tabs.length > 1 ? 'flex' : 'none';
  tabsEl.innerHTML = tabs.map(t => `<button data-board="${t.id}" class="${String(t.id) === String(currentBoardId) ? 'active' : ''}">${escapeHtml(t.name)}</button>`).join('');
  tabsEl.querySelectorAll('button[data-board]').forEach(btn => {
    btn.addEventListener('click', () => switchBoard(btn.dataset.board === 'courses' ? 'courses' : Number(btn.dataset.board)));
  });

  switchBoard(currentBoardId);
}

function switchBoard(boardId) {
  currentBoardId = boardId;
  document.querySelectorAll('#board-tabs button[data-board]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.board === String(boardId));
  });
  document.getElementById('board-courses').style.display = boardId === 'courses' ? 'block' : 'none';
  document.getElementById('board-generic').style.display = boardId === 'courses' ? 'none' : 'block';
  if (boardId === 'courses') return;

  const board = boards.find(b => b.id === boardId);
  document.getElementById('board-generic-title').textContent = board.name;
  if (boardViews[boardId]) {
    boardViews[boardId].refresh();
  } else {
    boardViews[boardId] = initBoardView({
      board,
      isAdmin: me.role === 'admin',
      me,
      containerIds: {
        theadRow: 'board-generic-thead',
        tbody: 'board-generic-rows',
        empty: 'board-generic-empty',
        form: 'board-generic-form',
        formFields: 'board-generic-form-fields',
        submitBtn: 'board-generic-submit',
        dateFilter: 'board-generic-date-filter',
        dateClear: 'board-generic-date-clear',
        total: 'board-generic-total',
        dayStats: 'board-generic-day-stats'
      },
      onChange: loadLog
    });
  }
}

async function loadProgramColors() {
  programColors = await api('/api/program-colors');
}

async function loadUsersList() {
  allUsers = await api('/api/users/list');
  const select = document.getElementById('filter-user');
  const current = select.value;
  select.innerHTML = '<option value="">All courses</option><option value="unassigned">Unassigned</option>'
    + allUsers.map(u => `<option value="${u.id}">${u.id === me.id ? 'My courses' : escapeHtml(u.name)}</option>`).join('');
  select.value = current;

  // Non-admins land on their own courses by default (fewer than an admin
  // would see, and the common case for someone just working their queue) —
  // but only on first load, so switching to "All courses" afterward sticks
  // across re-renders and live updates instead of snapping back.
  if (!defaultUserFilterApplied && me.role !== 'admin') {
    select.value = String(me.id);
    defaultUserFilterApplied = true;
  }
}

// Rebuilds the category filter's options from whatever categories are
// actually present, preserving the current selection if it still exists.
function refreshCategoryFilter(courses) {
  const select = document.getElementById('filter-category');
  const current = select.value;
  const categories = [...new Set(courses.map(c => c.category).filter(Boolean))].sort();
  select.innerHTML = '<option value="">All categories</option>'
    + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  select.value = current;
}

async function loadMe() {
  me = await api('/api/auth/me');
  document.getElementById('who-name').textContent = `${me.name} (${me.role})`;
  if (me.role === 'admin') document.getElementById('admin-link').style.display = 'inline';
  if (me.mustChangePassword) {
    document.getElementById('pw-warning').style.display = 'block';
  }
}

async function loadStats(courses) {
  const counts = { not_started: 0, in_progress: 0, done: 0 };
  courses.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
  const tiles = [
    ['Not started', counts.not_started],
    ['In progress', counts.in_progress],
    ['Done', counts.done],
    ['Total courses', courses.length]
  ];
  document.getElementById('stat-row').innerHTML = tiles.map(([label, value]) => `
    <div class="stat-tile"><div class="value">${value}</div><div class="label">${label}</div></div>
  `).join('');
}

async function loadCourses() {
  const showDone = document.getElementById('show-done').checked;
  const userFilter = document.getElementById('filter-user').value;
  const categoryFilter = document.getElementById('filter-category').value;

  const [allCourses, openIssues] = await Promise.all([api('/api/courses'), api('/api/issues?status=open')]);
  refreshCategoryFilter(allCourses);

  const openIssueCounts = {};
  openIssues.forEach(i => { openIssueCounts[i.courseId] = (openIssueCounts[i.courseId] || 0) + 1; });

  let courses = showDone ? allCourses : allCourses.filter(c => c.status !== 'done');
  if (userFilter === 'unassigned') courses = courses.filter(c => !c.assignedTo);
  else if (userFilter) courses = courses.filter(c => c.assignedTo === Number(userFilter));
  if (categoryFilter) courses = courses.filter(c => c.category === categoryFilter);
  courses = columnSort.sortCourses(courses);

  loadStats(allCourses);

  const tbody = document.getElementById('course-rows');
  document.getElementById('empty-state').style.display = courses.length ? 'none' : 'block';
  tbody.innerHTML = courses.map(c => {
    const isMine = c.assignedTo === me.id;
    const canClaim = !c.assignedTo && c.status !== 'done';
    const canAdvance = (isMine || me.role === 'admin') && c.status !== 'done';
    let actions = '';
    if (canClaim) actions += `<button class="small" data-action="claim" data-id="${c.id}">Claim</button> `;
    if (canAdvance && c.status === 'not_started') actions += `<button class="small primary" data-action="start" data-id="${c.id}">Start</button> `;
    if (canAdvance && c.status === 'in_progress') actions += `<button class="small primary" data-action="finish" data-id="${c.id}">Mark done</button> `;
    if (isMine && c.status !== 'done') actions += `<button class="small" data-action="unclaim" data-id="${c.id}">Give back</button> `;
    actions += `<button class="small" data-action="issues" data-id="${c.id}">⚠ Issues</button>`;
    return `<tr${openIssueCounts[c.id] ? ' class="has-issue"' : ''}>
      <td>${escapeHtml(c.title)}</td>
      <td class="muted">${escapeHtml(c.crn || '—')}</td>
      <td class="muted">${categorySwatch(c.category, programColors)}${escapeHtml(c.category || '—')}</td>
      <td>${badge(c.status)}${c.priority ? ' ' + priorityBadge() : ''}${' ' + issuesBadge(c, openIssueCounts[c.id])}</td>
      <td class="muted">${c.assignedToName ? escapeHtml(c.assignedToName) : '—'}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    if (btn.dataset.action === 'issues') {
      btn.addEventListener('click', () => issuesDialog.open(allCourses.find(c => c.id === Number(btn.dataset.id))));
    } else {
      btn.addEventListener('click', () => handleCourseAction(btn.dataset.action, Number(btn.dataset.id)));
    }
  });
  tbody.querySelectorAll('span[data-issues-id]').forEach(el => {
    el.addEventListener('click', () => issuesDialog.open(allCourses.find(c => c.id === Number(el.dataset.issuesId))));
  });
}

async function handleCourseAction(action, id) {
  try {
    if (action === 'claim') await api(`/api/courses/${id}`, { method: 'PATCH', body: JSON.stringify({ claim: true }) });
    if (action === 'start') await api(`/api/courses/${id}`, { method: 'PATCH', body: JSON.stringify({ claim: true, status: 'in_progress' }) });
    if (action === 'finish') await api(`/api/courses/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    if (action === 'unclaim') await api(`/api/courses/${id}`, { method: 'PATCH', body: JSON.stringify({ unclaim: true }) });
    await loadCourses();
    await loadLog();
  } catch (err) {
    alert(err.message);
  }
}

async function loadLog() {
  const entries = await api('/api/activity/mine');
  const tbody = document.getElementById('log-rows');
  document.getElementById('log-empty').style.display = entries.length ? 'none' : 'block';
  tbody.innerHTML = entries.map(e => `
    <tr>
      <td class="muted small">${fmtTime(e.timestamp)}</td>
      <td>${escapeHtml(e.courseTitle || e.itemTitle || '—')}</td>
      <td>${escapeHtml(e.action.replace('_', ' '))}</td>
      <td>${e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus ? `${STATUS_LABEL[e.fromStatus] || e.fromStatus} → ${STATUS_LABEL[e.toStatus] || e.toStatus}` : '—'}</td>
      <td class="muted small">${escapeHtml(e.notes || '—')}</td>
    </tr>
  `).join('');
}

document.getElementById('show-done').addEventListener('change', loadCourses);
document.getElementById('filter-user').addEventListener('change', loadCourses);
document.getElementById('filter-category').addEventListener('change', loadCourses);

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

const pwDialog = document.getElementById('pw-dialog');
document.getElementById('change-pw-btn').addEventListener('click', () => pwDialog.showModal());
document.getElementById('pw-warning-link').addEventListener('click', (e) => { e.preventDefault(); pwDialog.showModal(); });
document.getElementById('pw-cancel').addEventListener('click', () => pwDialog.close());
document.getElementById('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword = document.getElementById('pw-new').value;
  const errorEl = document.getElementById('pw-error');
  errorEl.style.display = 'none';
  try {
    await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    pwDialog.close();
    document.getElementById('pw-warning').style.display = 'none';
    document.getElementById('pw-form').reset();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
});

(async function init() {
  await loadMe();
  issuesDialog = initIssuesDialog({ isAdmin: me.role === 'admin', onChange: loadCourses });
  // Decide board visibility (and switch to the right default tab) before
  // loading any course data, so a user without Courses access never sees
  // a flash of course content before it's hidden.
  await loadBoards();
  if (document.getElementById('board-courses').style.display !== 'none') {
    await loadProgramColors();
    await loadUsersList();
    await loadCourses();
  }
  await loadLog();
  subscribeToUpdates((scopes) => {
    if (scopes.includes('courses')) loadCourses();
    if (scopes.includes('activity')) loadLog();
    if (scopes.includes('users')) loadUsersList();
    if (scopes.includes('programColors')) loadProgramColors().then(loadCourses);
    if (scopes.includes('issues')) loadCourses();
    if (scopes.includes('boardMembers')) loadBoards();
    if (typeof currentBoardId === 'number' && scopes.includes(`items:${currentBoardId}`) && boardViews[currentBoardId]) {
      boardViews[currentBoardId].refresh();
    }
  });
})();
