const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };

function badge(status) {
  return `<span class="badge ${status}"><span class="dot"></span>${STATUS_LABEL[status] || status}</span>`;
}

function priorityBadge() {
  return `<span class="badge priority" title="Marked higher priority">★ Priority</span>`;
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
