let users = [];
let programColors = {};

// Named theme presets for the brand-color picker (quick-pick swatches).
// Each swatch uses the theme's "circle" value — the color the theme design
// uses to represent itself, matching how QuickDash shows a single swatch.
const COLOR_PRESETS = [
  { name: 'lake', circle: '#005F63' },
  { name: 'sky', circle: '#2ECDDC' },
  { name: 'sunset', circle: '#FF8204' },
  { name: 'peach', circle: '#DE4F3D' },
  { name: 'cherry', circle: '#E10040' },
  { name: 'cabernet', circle: '#782434' },
  { name: 'lavender', circle: '#50037F' },
  { name: 'lilac', circle: '#CA9CE4' },
  { name: 'charcoal', circle: '#50534C' }
];

document.getElementById('pc-presets').innerHTML = COLOR_PRESETS.map(p => `
  <button type="button" class="swatch-btn" style="background:${p.circle}" title="${p.name} (${p.circle})" data-color="${p.circle}"></button>
`).join('');
document.getElementById('pc-presets').querySelectorAll('button[data-color]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('pc-color').value = btn.dataset.color;
  });
});

document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['users', 'courses', 'colors', 'logs'].forEach(t => {
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

  const logFilter = document.getElementById('log-user-filter');
  logFilter.innerHTML = '<option value="">All users</option>' + users.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

  const courseFilter = document.getElementById('admin-filter-user');
  const current = courseFilter.value;
  courseFilter.innerHTML = '<option value="">All users</option><option value="unassigned">Unassigned</option>'
    + users.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
  courseFilter.value = current;

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

// Every distinct category currently in use by a course, kept up to date by
// loadAdminCourses() so the Brand colors tab can list categories that don't
// have a color yet, not just ones that already do.
let knownCategories = [];

async function loadAdminCourses() {
  const userFilter = document.getElementById('admin-filter-user').value;
  const categoryFilter = document.getElementById('admin-filter-category').value;

  const allCourses = await api('/api/courses');

  const categories = [...new Set(allCourses.map(c => c.category).filter(Boolean))].sort();
  knownCategories = categories;
  document.getElementById('pc-category-options').innerHTML = categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
  const categorySelect = document.getElementById('admin-filter-category');
  const currentCategory = categorySelect.value;
  categorySelect.innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  categorySelect.value = currentCategory;

  let courses = allCourses;
  if (userFilter === 'unassigned') courses = courses.filter(c => !c.assignedTo);
  else if (userFilter) courses = courses.filter(c => c.assignedTo === Number(userFilter));
  if (categoryFilter) courses = courses.filter(c => c.category === categoryFilter);
  courses = courses.sort((a, b) =>
    (b.priority === true) - (a.priority === true) ||
    Boolean(b.crn) - Boolean(a.crn) ||
    a.title.localeCompare(b.title));

  const tbody = document.getElementById('admin-course-rows');
  tbody.innerHTML = courses.map(c => `
    <tr>
      <td>${escapeHtml(c.title)}</td>
      <td class="muted">${escapeHtml(c.crn || '—')}</td>
      <td class="muted">${categorySwatch(c.category, programColors)}${escapeHtml(c.category || '—')}</td>
      <td>
        <select data-id="${c.id}" data-action="set-status">
          ${['not_started', 'in_progress', 'done'].map(s => `<option value="${s}" ${s === c.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
        ${c.priority ? ' ' + priorityBadge() : ''}
      </td>
      <td>
        <select data-id="${c.id}" data-action="assign">
          <option value="">Unassigned</option>
          ${users.map(u => `<option value="${u.id}" ${c.assignedTo === u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
        </select>
      </td>
      <td>
        <button class="small" data-id="${c.id}" data-action="toggle-priority">${c.priority ? 'Unmark priority' : 'Mark priority'}</button>
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
  tbody.querySelectorAll('select[data-action="set-status"]').forEach(sel => {
    sel.addEventListener('change', async () => {
      await api(`/api/courses/${sel.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: sel.value }) });
      await loadAdminCourses();
    });
  });
  tbody.querySelectorAll('select[data-action="assign"]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const value = sel.value ? Number(sel.value) : null;
      await api(`/api/courses/${sel.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ assignTo: value }) });
      await loadAdminCourses();
    });
  });
}

// ---- Program brand colors ----

// The category currently loaded into the form for editing, if any — lets
// Save update that entry in place (renaming it if the category text
// changed) instead of always creating a new one.
let editingCategory = null;

function setEditingCategory(cat) {
  editingCategory = cat;
  document.getElementById('pc-cancel-edit').style.display = cat ? 'inline-block' : 'none';
  document.getElementById('pc-save-btn').textContent = cat ? 'Update' : 'Save';
}

async function loadProgramColors() {
  programColors = await api('/api/program-colors');
  const rowsEl = document.getElementById('program-color-rows');
  // Union of categories that already have a color and ones that don't yet,
  // so this list doubles as a checklist for "assign a color to everything."
  const categories = [...new Set([...Object.keys(programColors), ...knownCategories])].sort();
  if (!categories.length) {
    rowsEl.innerHTML = '<p class="muted small">No categories yet — import or add some courses first.</p>';
    return;
  }
  rowsEl.innerHTML = categories.map(cat => {
    const color = programColors[cat];
    return `
    <div class="swatch-row${cat === editingCategory ? ' editing' : ''}" data-category="${escapeHtml(cat)}" style="cursor:pointer;">
      <span class="swatch swatch-lg" style="background:${color ? escapeHtml(color) : 'transparent'};border-style:${color ? 'solid' : 'dashed'};"></span>
      <span>${escapeHtml(cat)}</span>
      <span class="muted small">${color ? escapeHtml(color) : 'No color set'}</span>
      ${color ? `<button class="small" data-category="${escapeHtml(cat)}" data-action="delete-color">Remove</button>` : ''}
    </div>
  `;
  }).join('');
  rowsEl.querySelectorAll('.swatch-row').forEach(row => {
    row.addEventListener('click', () => {
      const cat = row.dataset.category;
      document.getElementById('pc-category').value = cat;
      document.getElementById('pc-color').value = programColors[cat] || '#2a78d6';
      setEditingCategory(cat);
    });
  });
  rowsEl.querySelectorAll('button[data-action="delete-color"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/program-colors/${encodeURIComponent(btn.dataset.category)}`, { method: 'DELETE' });
      if (btn.dataset.category === editingCategory) {
        document.getElementById('program-color-form').reset();
        setEditingCategory(null);
      }
      await loadProgramColors();
      await loadAdminCourses();
    });
  });
}

document.getElementById('pc-cancel-edit').addEventListener('click', () => {
  document.getElementById('program-color-form').reset();
  setEditingCategory(null);
});

document.getElementById('program-color-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = document.getElementById('pc-category').value.trim();
  const color = document.getElementById('pc-color').value;
  try {
    await api(`/api/program-colors/${encodeURIComponent(category)}`, { method: 'PUT', body: JSON.stringify({ color }) });
    // Renamed while editing (category text changed) — drop the old entry
    // instead of leaving it behind as a near-duplicate.
    if (editingCategory && editingCategory !== category) {
      await api(`/api/program-colors/${encodeURIComponent(editingCategory)}`, { method: 'DELETE' });
    }
    document.getElementById('program-color-form').reset();
    setEditingCategory(null);
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
  const crn = document.getElementById('course-crn').value.trim();
  try {
    await api('/api/courses', { method: 'POST', body: JSON.stringify({ title, category, crn }) });
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
    if (data.duplicates) {
      notes.push(data.updated
        ? `${data.duplicates} already existed (${data.updated} had their category/CRN updated)`
        : `${data.duplicates} already existed, left untouched`);
    }
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
document.getElementById('admin-filter-user').addEventListener('change', loadAdminCourses);
document.getElementById('admin-filter-category').addEventListener('change', loadAdminCourses);

(async function init() {
  await loadMe();
  await loadUsers();
  await loadAdminCourses();
  await loadProgramColors();
  subscribeToUpdates((scopes) => {
    if (scopes.includes('users')) loadUsers();
    if (scopes.includes('courses')) loadAdminCourses().then(loadProgramColors);
    if (scopes.includes('activity')) loadLogs();
    if (scopes.includes('programColors')) loadProgramColors();
  });
})();
