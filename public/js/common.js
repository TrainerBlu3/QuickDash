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
