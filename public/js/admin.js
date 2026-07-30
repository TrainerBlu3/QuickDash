let users = [];
let programColors = {};

document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['users', 'courses', 'logs'].forEach(t => {
      document.getElementById(`tab-${t}`).style.display = t === btn.dataset.tab ? 'block' : 'none';
    });
    if (btn.dataset.tab === 'logs') loadLogs();
  });
});

async function loadMe() {
  const me = await api('/api/auth/me');
  document.getElementById('who-name').textContent = `${me.name} (${me.role})`;
  if (me.role !== 'admin') {
    document.body.innerHTML = '<div class="container"><div class="card"><h2>Admin access required</h2><a href="/">Back to dashboard</a></div></div>';
    throw new Error('not admin');
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---- Users ----

async function loadUsers() {
  users = await api('/api/users');
  const tbody = document.getElementById('user-rows');
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td class="muted">${escapeHtml(u.username)}</td>
      <td>${u.role}</td>
      <td>${u.active ? 'active' : 'disabled'}${u.mustChangePassword ? ' <span class="muted small">(temp pw)</span>' : ''}</td>
      <td>
        <button class="small" data-action="reset" data-id="${u.id}">Reset password</button>
        <button class="small" data-action="toggle" data-id="${u.id}">${u.active ? 'Disable' : 'Enable'}</button>
      </td>
    </tr>
  `).join('');

  const filter = document.getElementById('log-user-filter');
  filter.innerHTML = '<option value="">All users</option>' + users.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleUserAction(btn.dataset.action, Number(btn.dataset.id)));
  });
}

async function handleUserAction(action, id) {
  try {
    if (action === 'reset') {
      if (!confirm('Reset this user\'s password? They will need the new temporary password to log in.')) return;
      const result = await api(`/api/users/${id}/reset-password`, { method: 'POST' });
      showCredentials(result);
    }
    if (action === 'toggle') {
      const user = users.find(u => u.id === id);
      await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ active: !user.active }) });
    }
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

function showCredentials(result) {
  document.getElementById('new-user-credentials').innerHTML = `
    <div class="credential-box">
      Share these login details with <b>${escapeHtml(result.name)}</b> — shown only once:<br>
      Username: <code>${escapeHtml(result.username)}</code> &nbsp; Password: <code>${escapeHtml(result.tempPassword)}</code>
      <div class="small muted" style="margin-top:6px;">They'll be asked to set their own password on first login.</div>
    </div>`;
}

document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('new-username').value.trim();
  const name = document.getElementById('new-name').value.trim();
  const role = document.getElementById('new-role').value;
  try {
    const result = await api('/api/users', { method: 'POST', body: JSON.stringify({ username, name, role }) });
    showCredentials(result);
    document.getElementById('user-form').reset();
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
});

// ---- Courses ----

async function loadAdminCourses() {
  const courses = (await api('/api/courses')).sort((a, b) => (b.priority === true) - (a.priority === true));

  const categories = [...new Set(courses.map(c => c.category).filter(Boolean))].sort();
  document.getElementById('pc-category-options').innerHTML = categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');

  const tbody = document.getElementById('admin-course-rows');
  tbody.innerHTML = courses.map(c => `
    <tr>
      <td>${escapeHtml(c.title)}</td>
      <td class="muted">${categorySwatch(c.category, programColors)}${escapeHtml(c.category || '—')}</td>
      <td>
        <select data-id="${c.id}" data-action="set-status">
          ${['not_started', 'in_progress', 'done'].map(s => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
        ${c.priority ? ' ' + priorityBadge() : ''}
      </td>
      <td class="muted">${c.assignedToName ? escapeHtml(c.assignedToName) : '—'}</td>
      <td>
        <button class="small" data-id="${c.id}" data-action="toggle-priority">${c.priority ? 'Unmark priority' : 'Mark priority'}</button>
        ${c.assignedToName ? `<button class="small" data-id="${c.id}" data-action="unclaim">Unclaim</button>` : ''}
        <button class="small" data-id="${c.id}" data-action="delete">Delete</button>
      </td>
    </tr>
  `).join('');
  tbody.querySelectorAll('button[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this course? This does not delete its activity history.')) return;
      await api(`/api/courses/${btn.dataset.id}`, { method: 'DELETE' });
      await loadAdminCourses();
    });
  });
  tbody.querySelectorAll('button[data-action="toggle-priority"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const course = courses.find(c => c.id === Number(btn.dataset.id));
      await api(`/api/courses/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ priority: !course.priority }) });
      await loadAdminCourses();
    });
  });
  tbody.querySelectorAll('button[data-action="unclaim"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const course = courses.find(c => c.id === Number(btn.dataset.id));
      if (!confirm(`Release ${escapeHtml(course.assignedToName)}'s claim on "${course.title}"?`)) return;
      await api(`/api/courses/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ unclaim: true }) });
      await loadAdminCourses();
    });
  });
  tbody.querySelectorAll('select[data-action="set-status"]').forEach(sel => {
    sel.addEventListener('change', async () => {
      await api(`/api/courses/${sel.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: sel.value }) });
      await loadAdminCourses();
    });
  });
}

// ---- Program brand colors ----

async function loadProgramColors() {
  programColors = await api('/api/program-colors');
  const rowsEl = document.getElementById('program-color-rows');
  const categories = Object.keys(programColors).sort();
  if (!categories.length) {
    rowsEl.innerHTML = '<p class="muted small">No brand colors set yet.</p>';
    return;
  }
  rowsEl.innerHTML = categories.map(cat => `
    <div class="swatch-row">
      <span class="swatch swatch-lg" style="background:${escapeHtml(programColors[cat])}"></span>
      <span>${escapeHtml(cat)}</span>
      <span class="muted small">${escapeHtml(programColors[cat])}</span>
      <button class="small" data-category="${escapeHtml(cat)}" data-action="delete-color">Remove</button>
    </div>
  `).join('');
  rowsEl.querySelectorAll('button[data-action="delete-color"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/program-colors/${encodeURIComponent(btn.dataset.category)}`, { method: 'DELETE' });
      await loadProgramColors();
      await loadAdminCourses();
    });
  });
}

document.getElementById('program-color-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = document.getElementById('pc-category').value.trim();
  const color = document.getElementById('pc-color').value;
  try {
    await api(`/api/program-colors/${encodeURIComponent(category)}`, { method: 'PUT', body: JSON.stringify({ color }) });
    document.getElementById('pc-category').value = '';
    await loadProgramColors();
    await loadAdminCourses();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('course-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('course-title').value.trim();
  const category = document.getElementById('course-category').value.trim();
  try {
    await api('/api/courses', { method: 'POST', body: JSON.stringify({ title, category }) });
    document.getElementById('course-form').reset();
    await loadAdminCourses();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('import-file');
  if (!fileInput.files[0]) return;
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  const res = await fetch('/api/courses/import', { method: 'POST', body: formData });
  const data = await res.json();
  const resultEl = document.getElementById('import-result');
  if (!res.ok) {
    resultEl.textContent = data.error || 'Import failed';
  } else {
    const notes = [];
    if (data.duplicates) notes.push(`${data.duplicates} already existed, left untouched`);
    if (data.skipped) notes.push(`${data.skipped} skipped — missing title`);
    if (data.colorDetected) notes.push(`from cell colors: ${data.colorDetected.done} marked done, ${data.colorDetected.priority} marked priority`);
    resultEl.textContent = `Added ${data.created} new course${data.created === 1 ? '' : 's'} of ${data.totalRows} rows${notes.length ? ` (${notes.join('; ')})` : ''}.`;
    fileInput.value = '';
    await loadAdminCourses();
  }
});

// ---- Logs ----

async function loadLogs() {
  const userId = document.getElementById('log-user-filter').value;
  const entries = await api(userId ? `/api/activity?userId=${userId}` : '/api/activity');
  const tbody = document.getElementById('admin-log-rows');
  tbody.innerHTML = entries.map(e => `
    <tr>
      <td class="muted small">${fmtTime(e.timestamp)}</td>
      <td>${escapeHtml(e.username)}</td>
      <td>${escapeHtml(e.courseTitle)}</td>
      <td>${escapeHtml(e.action.replace('_', ' '))}</td>
      <td>${e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus ? `${STATUS_LABEL[e.fromStatus]} → ${STATUS_LABEL[e.toStatus]}` : '—'}</td>
      <td class="muted small">${escapeHtml(e.notes || '—')}</td>
    </tr>
  `).join('');
}

document.getElementById('log-user-filter').addEventListener('change', loadLogs);

(async function init() {
  await loadMe();
  await loadUsers();
  await loadProgramColors();
  await loadAdminCourses();
  subscribeToUpdates((scopes) => {
    if (scopes.includes('users')) loadUsers();
    if (scopes.includes('courses')) loadAdminCourses();
    if (scopes.includes('activity')) loadLogs();
    if (scopes.includes('programColors')) loadProgramColors().then(loadAdminCourses);
  });
})();
