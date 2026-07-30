let me = null;
let programColors = {};

async function loadProgramColors() {
  programColors = await api('/api/program-colors');
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
  const allCourses = await api('/api/courses');
  const courses = (showDone ? allCourses : allCourses.filter(c => c.status !== 'done'))
    .sort((a, b) => (b.priority === true) - (a.priority === true));
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
    return `<tr>
      <td>${escapeHtml(c.title)}</td>
      <td class="muted">${categorySwatch(c.category, programColors)}${escapeHtml(c.category || '—')}</td>
      <td>${badge(c.status)}${c.priority ? ' ' + priorityBadge() : ''}</td>
      <td class="muted">${c.assignedToName ? escapeHtml(c.assignedToName) : '—'}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleCourseAction(btn.dataset.action, Number(btn.dataset.id)));
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
      <td>${escapeHtml(e.courseTitle)}</td>
      <td>${escapeHtml(e.action.replace('_', ' '))}</td>
      <td>${e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus ? `${STATUS_LABEL[e.fromStatus]} → ${STATUS_LABEL[e.toStatus]}` : '—'}</td>
      <td class="muted small">${escapeHtml(e.notes || '—')}</td>
    </tr>
  `).join('');
}

document.getElementById('show-done').addEventListener('change', loadCourses);

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
  await loadProgramColors();
  await loadCourses();
  await loadLog();
  subscribeToUpdates((scopes) => {
    if (scopes.includes('courses')) loadCourses();
    if (scopes.includes('activity')) loadLog();
    if (scopes.includes('programColors')) loadProgramColors().then(loadCourses);
  });
})();
