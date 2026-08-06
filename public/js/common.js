const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };

function badge(status) {
  return `<span class="badge ${status}"><span class="dot"></span>${STATUS_LABEL[status] || status}</span>`;
}

function priorityBadge() {
  return `<span class="badge priority" title="Marked higher priority">★ Priority</span>`;
}

// Clickable warning badge shown next to a course that has open issues
// reported against it — data-issues-id lets the row's click handler know
// which course's issue dialog to open.
function issuesBadge(course, openCount) {
  if (!openCount) return '';
  return `<span class="badge issue" data-issues-id="${course.id}" title="${openCount} open issue${openCount === 1 ? '' : 's'} reported — click for details">⚠ ${openCount} issue${openCount === 1 ? '' : 's'}</span>`;
}

// Shared "Issues" dialog: lists everything reported against one course and
// lets anyone add a new report. When isAdmin is true, each issue also gets
// resolve/reopen/remove controls. Both index.html and admin.html include
// the same #issues-dialog markup so this one controller works for either
// page — onChange is called after any write so the caller can refresh its
// own course table (badge counts, etc).
function initIssuesDialog({ isAdmin, onChange }) {
  const dialog = document.getElementById('issues-dialog');
  const titleEl = document.getElementById('issues-dialog-title');
  const listEl = document.getElementById('issues-list');
  const form = document.getElementById('issues-report-form');
  const descInput = document.getElementById('issue-description');
  let currentCourse = null;

  function renderIssue(issue) {
    const statusBadge = issue.status === 'resolved'
      ? `<span class="badge done"><span class="dot"></span>Resolved</span>`
      : `<span class="badge not_started"><span class="dot"></span>Open</span>`;
    const adminControls = isAdmin ? `
      <div class="row small" style="margin-top:6px;">
        <button type="button" class="small" data-action="${issue.status === 'resolved' ? 'reopen' : 'resolve'}" data-id="${issue.id}">${issue.status === 'resolved' ? 'Reopen' : 'Resolve'}</button>
        <button type="button" class="small" data-action="remove" data-id="${issue.id}">Remove</button>
      </div>` : '';
    return `
      <div class="issue-item">
        <div class="row spread">
          <b>${escapeHtml(issue.reportedByName)}</b>
          ${statusBadge}
        </div>
        <div>${escapeHtml(issue.description)}</div>
        <div class="muted small">${fmtTime(issue.createdAt)}${issue.status === 'resolved' ? ` · resolved ${fmtTime(issue.resolvedAt)} by ${escapeHtml(issue.resolvedByName || '—')}` : ''}</div>
        ${adminControls}
      </div>`;
  }

  async function refresh() {
    const issues = await api(`/api/issues?courseId=${currentCourse.id}`);
    listEl.innerHTML = issues.length
      ? issues.map(renderIssue).join('')
      : '<p class="muted small">No issues reported for this course yet.</p>';
    listEl.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        try {
          if (btn.dataset.action === 'resolve') await api(`/api/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
          if (btn.dataset.action === 'reopen') await api(`/api/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) });
          if (btn.dataset.action === 'remove') {
            if (!confirm('Remove this issue? This cannot be undone.')) return;
            await api(`/api/issues/${id}`, { method: 'DELETE' });
          }
          await refresh();
          if (onChange) onChange();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/issues', { method: 'POST', body: JSON.stringify({ courseId: currentCourse.id, description: descInput.value.trim() }) });
      descInput.value = '';
      await refresh();
      if (onChange) onChange();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById('issues-dialog-close').addEventListener('click', () => dialog.close());

  return {
    open(course) {
      currentCourse = course;
      titleEl.textContent = `Issues — ${course.title}`;
      listEl.innerHTML = '<p class="muted small">Loading…</p>';
      dialog.showModal();
      refresh();
    }
  };
}

// Generic board-item view: builds a table + create form for any board's
// items from board.fields/board.statuses metadata, instead of hardcoded
// course columns. Mirrors the claim/unclaim/advance UX of app.js's
// loadCourses(), but status-list-driven — the same controller works for
// Tickets today and any future board without another rewrite. Both
// containerIds.thead/tbody/empty/form/formFields/submitBtn must already
// exist in the calling page's markup.
function initBoardView({ board, isAdmin, me, containerIds, onChange }) {
  const theadRow = document.getElementById(containerIds.theadRow);
  const tbody = document.getElementById(containerIds.tbody);
  const emptyEl = document.getElementById(containerIds.empty);
  const form = document.getElementById(containerIds.form);
  const formFieldsEl = document.getElementById(containerIds.formFields);
  const submitBtn = document.getElementById(containerIds.submitBtn);

  const initialStatus = board.statuses[0];
  const terminalStatus = board.statuses[board.statuses.length - 1];

  function statusBadgeClass(status) {
    if (status === terminalStatus) return 'done';
    if (status === initialStatus) return 'not_started';
    return 'in_progress';
  }
  function statusLabel(status) {
    return status.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }

  theadRow.innerHTML = `<th>Title</th>${board.fields.map(f => `<th>${escapeHtml(f.label)}</th>`).join('')}<th>Status</th><th>Assigned to</th><th></th>`;
  formFieldsEl.innerHTML = `
    <input type="text" name="title" placeholder="Title" required class="flex-1 min-w-[160px]">
    ${board.fields.map(f => `<input type="text" name="field:${f.key}" placeholder="${escapeHtml(f.label)}" class="flex-1 min-w-[160px]">`).join('')}
  `;
  submitBtn.textContent = `Log ${board.itemLabel}`;

  async function refresh() {
    const items = await api(`/api/boards/${board.id}/items`);
    emptyEl.style.display = items.length ? 'none' : 'block';
    tbody.innerHTML = items.map(item => {
      const isMine = item.assignedTo === me.id;
      const canClaim = !item.assignedTo && item.status !== terminalStatus;
      const canManage = (isMine || isAdmin) && item.status !== terminalStatus;
      const currentIdx = board.statuses.indexOf(item.status);

      let actions = '';
      if (canClaim) actions += `<button class="small whitespace-nowrap" data-action="claim" data-id="${item.id}">Claim</button> `;
      if (canManage) {
        board.statuses.slice(currentIdx + 1).forEach(s => {
          actions += `<button class="small primary whitespace-nowrap" data-action="status" data-status="${s}" data-id="${item.id}">Mark ${escapeHtml(statusLabel(s))}</button> `;
        });
      }
      if (isMine && item.status !== terminalStatus) actions += `<button class="small whitespace-nowrap" data-action="unclaim" data-id="${item.id}">Give back</button> `;
      if (isAdmin) actions += `<button class="small whitespace-nowrap" data-action="delete" data-id="${item.id}">Delete</button>`;

      return `<tr class="status-${item.status}">
        <td>${escapeHtml(item.title)}</td>
        ${board.fields.map(f => `<td class="muted">${escapeHtml(item.fields[f.key] || '—')}</td>`).join('')}
        <td><span class="badge ${statusBadgeClass(item.status)}"><span class="dot"></span>${escapeHtml(statusLabel(item.status))}</span></td>
        <td class="muted">${item.assignedToName ? escapeHtml(item.assignedToName) : '—'}</td>
        <td class="flex flex-wrap gap-1">${actions}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action, Number(btn.dataset.id), btn.dataset.status));
    });
  }

  async function handleAction(action, id, status) {
    try {
      if (action === 'claim') await api(`/api/boards/${board.id}/items/${id}`, { method: 'PATCH', body: JSON.stringify({ claim: true }) });
      if (action === 'unclaim') await api(`/api/boards/${board.id}/items/${id}`, { method: 'PATCH', body: JSON.stringify({ unclaim: true }) });
      if (action === 'status') await api(`/api/boards/${board.id}/items/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      if (action === 'delete') {
        if (!confirm(`Delete this ${board.itemLabel}? This cannot be undone.`)) return;
        await api(`/api/boards/${board.id}/items/${id}`, { method: 'DELETE' });
      }
      await refresh();
      if (onChange) onChange();
    } catch (err) {
      alert(err.message);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const fields = {};
    board.fields.forEach(f => { fields[f.key] = data.get(`field:${f.key}`) || ''; });
    try {
      await api(`/api/boards/${board.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ title: data.get('title'), fields })
      });
      form.reset();
      await refresh();
      if (onChange) onChange();
    } catch (err) {
      alert(err.message);
    }
  });

  refresh();
  return { refresh };
}

// A small color swatch for a course's category, if a brand color is set for it.
function categorySwatch(category, programColors) {
  const color = programColors && programColors[category];
  if (!color) return '';
  return `<span class="swatch" style="background:${escapeHtml(color)}" title="${escapeHtml(category)} brand color: ${escapeHtml(color)}"></span>`;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Click-to-sort for a course table's <th data-sort="field"> headers.
// Wires the headers currently in the page (each page calls this once, so
// the dashboard and Admin tables get independent sort state) and returns
// sortCourses() for the page's render loop to call. With no column chosen
// yet, falls back to the app's usual default: priority, then has-a-CRN,
// then alphabetical.
function createColumnSort(onSortChange) {
  const state = { field: null, dir: 'asc' };
  const STATUS_ORDER = { not_started: 0, in_progress: 1, done: 2 };

  function compareField(a, b, field, dir) {
    if (field === 'status') {
      let result = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (result === 0) result = (b.priority === true) - (a.priority === true);
      if (result === 0) result = a.title.localeCompare(b.title);
      return dir === 'asc' ? result : -result;
    }
    const av = (a[field] || '').toString().trim();
    const bv = (b[field] || '').toString().trim();
    if (!av && !bv) return 0;
    if (!av) return 1; // blanks always sort last, in either direction
    if (!bv) return -1;
    const result = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
    return dir === 'asc' ? result : -result;
  }

  function defaultSort(a, b) {
    return (b.priority === true) - (a.priority === true) ||
      Boolean(b.crn) - Boolean(a.crn) ||
      a.title.localeCompare(b.title);
  }

  function updateArrows() {
    document.querySelectorAll('th[data-sort]').forEach(th => {
      const arrow = th.querySelector('.sort-arrow');
      if (!arrow) return;
      arrow.textContent = th.dataset.sort === state.field ? (state.dir === 'asc' ? '▲' : '▼') : '';
    });
  }

  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      state.dir = state.field === th.dataset.sort && state.dir === 'asc' ? 'desc' : 'asc';
      state.field = th.dataset.sort;
      updateArrows();
      onSortChange();
    });
  });

  return {
    sortCourses(courses) {
      return state.field ? courses.sort((a, b) => compareField(a, b, state.field, state.dir)) : courses.sort(defaultSort);
    }
  };
}

// Dark mode: style.css already keys its colors off a `data-theme` attribute
// on <html>, falling back to the OS preference when unset. This just adds
// an explicit override, persisted in localStorage.
function currentTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit) return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const updateIcon = () => { btn.textContent = currentTheme() === 'dark' ? '☀️' : '🌙'; };
  updateIcon();
  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('quickdash-theme', next);
    updateIcon();
  });
}
initThemeToggle();

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('logged out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Live updates: the server pushes a { scopes: [...] } message whenever
// courses, activity, or users change anywhere. Reconnects automatically
// on drop (EventSource's built-in retry) so a network blip just resumes.
function subscribeToUpdates(onScopes) {
  const source = new EventSource('/api/events');
  source.onmessage = (e) => {
    try {
      const { scopes } = JSON.parse(e.data);
      onScopes(scopes || []);
    } catch { /* ignore malformed/heartbeat messages */ }
  };
  return source;
}
