const el = (id) => document.getElementById(id);
const ui = {
  list: el('post-list'), editor: el('editor'), empty: el('empty'),
  title: el('title'), content: el('content'), preview: el('preview'),
  words: el('word-count'), save: el('save-state'),
  panes: el('panes'),
  modeButtons: Array.from(document.querySelectorAll('.mode-btn')),
  publishBtn: el('publish'),
  deleteBtn: el('delete'), newBtn: el('new-post'),
  totalPosts: el('total-posts'),
  shortcutsToggle: el('shortcuts-toggle'),
  shortcutsModal: el('shortcuts-modal'),
  modalClose: el('modal-close'),
  focusBtn: el('focus-toggle'),
  searchInput: el('search-input'),
  searchClear: el('search-clear'),
  readingTime: el('reading-time'),
  targetWords: el('target-words'),
  goalProgress: el('goal-progress'),
  goalContainer: el('goal-container'),
  postsBtn: el('posts-btn'),
  moreBtn: el('more-btn'),
  drawer: el('posts-drawer'),
  moreMenu: el('more-menu'),
  fontIncreaseBtn: el('font-increase'),
  fontDecreaseBtn: el('font-decrease'),
  fontSizeLabel: el('font-size-label'),
  widthButtons: Array.from(document.querySelectorAll('.width-btn')),
  historyBtn: el('history-btn'),
  historyModal: el('history-modal'),
  historyList: el('history-list'),
  historyDiff: el('history-diff'),
  historyRestore: el('history-restore'),
  historyMeta: el('history-meta'),
  historyClose: el('history-close'),
  scheduleAt: el('schedule-at'),
  scheduleBtn: el('schedule-btn'),
};

let posts = [];        // sidebar summaries, newest first
let current = null;    // full post being edited
let saveTimer = null;
let pendingSave = null;
let focusMode = false;

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// --- markdown -------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function inline(s) {
  const spans = [];
  s = s.replace(/`([^`]+)`/g, (_, code) => `\u0000${spans.push(code) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) =>
      /^(https?:|mailto:|[/#])/i.test(href) ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : m)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${spans[i]}</code>`);
}

function renderMarkdown(src) {
  const lines = escapeHtml(src).split('\n');
  const isBreak = (l) => !l.trim() || /^```/.test(l) || /^#{1,3}\s/.test(l) || /^\s*[-*]\s+/.test(l);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      i++; // closing fence
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
    } else if (/^(#{1,3})\s+(.*)$/.test(line)) {
      const [, hashes, text] = line.match(/^(#{1,3})\s+(.*)$/);
      out.push(`<h${hashes.length}>${inline(text)}</h${hashes.length}>`);
      i++;
    } else if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
    } else if (!line.trim()) {
      i++;
    } else {
      const para = [];
      while (i < lines.length && !isBreak(lines[i])) para.push(lines[i++]);
      out.push(`<p>${inline(para.join('\n'))}</p>`);
    }
  }
  return out.join('\n');
}

// --- snippet (pure) ------------------------------------------------------

function renderSnippet(raw) {
  if (!raw) return '';
  return raw
    .replace(/<mark>/g, '\u0001')
    .replace(/<\/mark>/g, '\u0002')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/\u0001/g, '<mark>')
    .replace(/\u0002/g, '</mark>');
}

// --- view mode (pure) -----------------------------------------------------

const VIEW_MODES = ['edit', 'split', 'preview'];

function normalizeViewMode(mode) {
  return VIEW_MODES.includes(mode) ? mode : VIEW_MODES[0];
}

function nextViewMode(mode) {
  const i = VIEW_MODES.indexOf(normalizeViewMode(mode));
  return VIEW_MODES[(i + 1) % VIEW_MODES.length];
}

function viewModeShowsPreview(mode) {
  return normalizeViewMode(mode) !== 'edit';
}

// --- view mode (dom) ------------------------------------------------------

let viewMode = 'edit';
const VIEW_MODE_KEY = 'inkwell-view-mode';

function refreshPreview() {
  if (!viewModeShowsPreview(viewMode)) return;
  ui.preview.innerHTML = renderMarkdown(ui.content.value);
}

function setViewMode(mode) {
  viewMode = normalizeViewMode(mode);
  document.body.dataset.viewMode = viewMode;
  localStorage.setItem(VIEW_MODE_KEY, viewMode);
  for (const btn of document.querySelectorAll('.mode-btn')) {
    const on = btn.dataset.mode === viewMode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  refreshPreview();
}

function cycleViewMode() {
  setViewMode(nextViewMode(viewMode));
}

// --- formatting -----------------------------------------------------------

function toMillis(ts) {
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
  if (typeof ts !== 'string') return NaN;
  // SQLite CURRENT_TIMESTAMP ("2026-07-28 10:36:00") is UTC but not ISO-parseable everywhere.
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) ? ts.replace(' ', 'T') + 'Z' : ts;
  return Date.parse(sqlite);
}

function relTime(ts) {
  const ms = toMillis(ts);
  if (Number.isNaN(ms)) return '';
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

// --- rendering ------------------------------------------------------------

function renderList() {
  ui.list.replaceChildren(...posts.map((p) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'post-item' + (current && p.id === current.id ? ' active' : '');
    item.dataset.id = p.id;

    const dot = document.createElement('span');
    dot.className = 'dot ' + dotClass(p.status);
    dot.title = p.status;

    const title = document.createElement('span');
    title.className = 'post-title';
    title.textContent = p.title || 'Untitled';

    const when = document.createElement('span');
    when.className = 'post-time';
    when.textContent = relTime(p.updated_at);

    const snip = document.createElement('span');
    snip.className = 'post-snippet';
    snip.innerHTML = renderSnippet(p.snippet || '');
    item.append(dot, title, when, snip);
    item.addEventListener('click', async () => {
      await selectPost(p.id);
      closePosts();
    });
    return item;
  }));
  ui.empty.hidden = posts.length > 0;
  if (posts.length === 0 && ui.searchInput && ui.searchInput.value.trim()) {
    ui.empty.textContent = 'No matching posts.';
  } else if (posts.length === 0) {
    ui.empty.textContent = 'No posts yet.';
  }
  updateTotals();
}

function renderEditor() {
  ui.editor.hidden = !current;
  if (!current) return;
  ui.title.value = current.title || '';
  ui.content.value = current.content || '';
  ui.publishBtn.textContent = current.status === 'published' ? 'unpublish' : 'publish';
  ui.publishBtn.classList.toggle('is-published', current.status === 'published');
  ui.scheduleBtn.textContent = scheduleButtonLabel(current.status);
  ui.scheduleBtn.classList.toggle('is-scheduled', current.status === 'scheduled');
  ui.scheduleAt.value = current.status === 'scheduled' && current.publish_at
    ? toLocalInputValue(current.publish_at)
    : '';
  if (ui.targetWords) ui.targetWords.value = current.target_word_count ?? 0;
  updateWordCount();
  refreshPreview();
}

function updateWordCount() {
  const n = countWords(ui.content.value);
  ui.words.textContent = `${n} ${n === 1 ? 'word' : 'words'}`;
  const minutes = calcReadingTime(n);
  ui.readingTime.textContent = minutes ? `${minutes} min read` : '';
  updateGoal();
  updateTotals();
}

function updateTotals() {
  const count = posts.length;
  ui.totalPosts.textContent = `${count} ${count === 1 ? 'post' : 'posts'}`;
}

function setSaveState(state) {
  ui.save.textContent = state;
  ui.save.classList.toggle('busy', state !== 'saved');
}

// --- data flow ------------------------------------------------------------

function mergeSummary(post) {
  const summary = {
    id: post.id, title: post.title, status: post.status,
    updated_at: post.updated_at, word_count: countWords(post.content || ''),
    target_word_count: post.target_word_count ?? 0,
  };
  posts = [summary, ...posts.filter((p) => p.id !== post.id)]
    .sort((a, b) => (toMillis(b.updated_at) || 0) - (toMillis(a.updated_at) || 0));
  renderList();
}

async function save() {
  if (!current) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  setSaveState('saving…');
  pendingSave = api('PUT', `/api/posts/${current.id}`, {
    title: ui.title.value,
    content: ui.content.value,
    target_word_count: Number(ui.targetWords.value) || 0,
  })
    .then((post) => {
      if (current && current.id === post.id) current = post;
      mergeSummary(post);
      setSaveState('saved');
    })
    .catch((err) => {
      console.warn(err);
      setSaveState('save failed');
    })
    .finally(() => { pendingSave = null; });
  return pendingSave;
}

function scheduleSave() {
  setSaveState('saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}

async function flushSave() {
  if (saveTimer) await save();
  if (pendingSave) await pendingSave;
}

async function selectPost(id) {
  if (current && current.id === id) return;
  await flushSave();
  current = await api('GET', `/api/posts/${id}`);
  setSaveState('saved');
  renderEditor();
  renderList();
}

function toggleShortcutsModal(show) {
  if (typeof show === 'boolean') {
    ui.shortcutsModal.hidden = !show;
  } else {
    ui.shortcutsModal.hidden = !ui.shortcutsModal.hidden;
  }
}

function toggleFocusMode(on) {
  focusMode = typeof on === 'boolean' ? on : !focusMode;
  document.body.classList.toggle('focus-mode', focusMode);
  ui.focusBtn?.classList.toggle('active', focusMode);
}

// --- quiet room: drawer & menu -------------------------------------------

function openPosts() {
  if (focusMode) toggleFocusMode(false);
  ui.drawer.classList.add('open');
  ui.drawer.setAttribute('aria-hidden', 'false');
  ui.searchInput?.focus();
}

function closePosts() {
  ui.drawer.classList.remove('open');
  ui.drawer.setAttribute('aria-hidden', 'true');
}

function openMore() {
  if (focusMode) toggleFocusMode(false);
  ui.moreMenu.classList.add('open');
  ui.moreMenu.setAttribute('aria-hidden', 'false');
}

function closeMore() {
  ui.moreMenu.classList.remove('open');
  ui.moreMenu.setAttribute('aria-hidden', 'true');
}

// --- quiet room: font size, reading time, goal ---------------------------

const FONT_SIZES = [16, 18, 20, 22, 24];
const FONT_SIZE_KEY = 'inkwell-font-size';
let fontSize = 18;

function applyFontSize() {
  document.documentElement.style.setProperty('--editor-font-size', `${fontSize}px`);
  if (ui.fontSizeLabel) ui.fontSizeLabel.textContent = `${fontSize}px`;
  localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
}

function setFontSize(n) {
  fontSize = Math.min(FONT_SIZES[FONT_SIZES.length - 1], Math.max(FONT_SIZES[0], n));
  applyFontSize();
}

const calcReadingTime = (words) => (words === 0 ? 0 : Math.ceil(words / 200));

function updateGoal() {
  const target = Number(ui.targetWords.value) || 0;
  if (target > 0) {
    const pct = Math.min(100, Math.round((countWords(ui.content.value) / target) * 100));
    ui.goalProgress.textContent = `${pct}%`;
    ui.goalContainer.classList.toggle('goal-met', pct >= 100);
  } else {
    ui.goalProgress.textContent = '—';
    ui.goalContainer.classList.remove('goal-met');
  }
}

(function initFontSize() {
  const stored = Number(localStorage.getItem(FONT_SIZE_KEY)) || 18;
  fontSize = FONT_SIZES.reduce((best, s) => (Math.abs(s - stored) < Math.abs(best - stored) ? s : best), FONT_SIZES[0]);
  applyFontSize();
})();

// --- quiet room: type width -------------------------------------------------

const TYPE_WIDTHS = { narrow: 560, medium: 720, wide: 960 };
const TYPE_WIDTH_KEY = 'inkwell-type-width';
let typeWidth = 'medium';

function applyTypeWidth() {
  document.documentElement.style.setProperty('--editor-max-width', `${TYPE_WIDTHS[typeWidth]}px`);
  for (const btn of document.querySelectorAll('.width-btn')) {
    const on = btn.dataset.width === typeWidth;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  localStorage.setItem(TYPE_WIDTH_KEY, typeWidth);
}

function setTypeWidth(w) {
  if (TYPE_WIDTHS[w]) { typeWidth = w; applyTypeWidth(); }
}

(function initTypeWidth() {
  const stored = localStorage.getItem(TYPE_WIDTH_KEY);
  typeWidth = TYPE_WIDTHS[stored] ? stored : 'medium';
  applyTypeWidth();
})();

// --- history (pure) ------------------------------------------------------

function escapeHtmlText(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function revisionReasonText(reason) {
  const labels = { edit: 'edit', publish: 'published', unpublish: 'unpublished', restore: 'restored' };
  return labels[reason] || reason;
}

function renderDiffLines(ops) {
  return ops.map(({ op, text }) => {
    const cls = op === '+' ? 'diff-add' : op === '-' ? 'diff-del' : 'diff-ctx';
    return `<div class="diff-line ${cls}"><span class="diff-op">${op}</span><span class="diff-text">${escapeHtmlText(text)}</span></div>`;
  }).join('\n');
}

// --- scheduled (pure) ------------------------------------------------------

function dotClass(status) {
  return status === 'published' ? 'published' : status === 'scheduled' ? 'scheduled' : 'draft';
}

function scheduleButtonLabel(status) {
  return status === 'scheduled' ? 'cancel schedule' : 'schedule';
}

/** datetime-local value (local time, no seconds) for a UTC ISO timestamp. */
function toLocalInputValue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** UTC ISO timestamp for a datetime-local value ("2026-08-18T09:00"). */
function toUtcIso(localValue) {
  return localValue ? new Date(localValue).toISOString() : '';
}

// --- history (dom) -------------------------------------------------------

let historyRevisions = [];
let selectedRevId = null;

async function openHistory() {
  if (!current) return;
  await flushSave(); // list reflects the latest snapshot
  historyRevisions = await api('GET', `/api/posts/${current.id}/revisions`);
  selectedRevId = null;
  renderHistoryList();
  ui.historyDiff.innerHTML = '';
  ui.historyMeta.textContent = '';
  ui.historyRestore.disabled = true;
  ui.historyModal.hidden = false;
}

function closeHistory() {
  ui.historyModal.hidden = true;
}

function renderHistoryList() {
  ui.historyList.replaceChildren(...historyRevisions.map((rev) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'history-item' + (rev.id === selectedRevId ? ' active' : '');
    item.dataset.id = rev.id;

    const when = document.createElement('span');
    when.className = 'history-when';
    when.textContent = relTime(rev.created_at);

    const detail = document.createElement('span');
    detail.className = 'history-detail';
    detail.textContent = `${rev.word_count} words · ${revisionReasonText(rev.reason)}`;

    item.append(when, detail);
    item.addEventListener('click', () => selectRevision(rev.id));
    return item;
  }));
}

async function selectRevision(revId) {
  selectedRevId = revId;
  renderHistoryList();
  const ops = await api('GET', `/api/posts/${current.id}/revisions/${revId}/diff`);
  ui.historyDiff.innerHTML = renderDiffLines(ops);
  const rev = historyRevisions.find((r) => r.id === revId);
  ui.historyMeta.textContent = rev ? `${revisionReasonText(rev.reason)} · ${rev.word_count} words` : '';
  ui.historyRestore.disabled = false;
}

async function restoreRevision() {
  if (!current || !selectedRevId) return;
  current = await api('POST', `/api/posts/${current.id}/revisions/${selectedRevId}/restore`);
  mergeSummary(current);
  renderEditor();
  closeHistory();
}

// --- search ---------------------------------------------------------------

let currentSearchQuery = '';

async function performSearch(query) {
  const trimmed = (query || '').trim();
  currentSearchQuery = trimmed;
  if (trimmed) {
    if (ui.searchClear) ui.searchClear.hidden = false;
    const res = await api('GET', `/api/posts?q=${encodeURIComponent(trimmed)}`);
    if (currentSearchQuery !== trimmed) return;
    posts = res;
  } else {
    if (ui.searchClear) ui.searchClear.hidden = true;
    const res = await api('GET', '/api/posts');
    if (currentSearchQuery !== '') return;
    posts = res;
  }
  renderList();
}

ui.searchInput?.addEventListener('input', (e) => performSearch(e.target.value));
ui.searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.searchInput.value) {
    e.preventDefault();
    e.stopPropagation();
    ui.searchInput.value = '';
    performSearch('');
  }
});
ui.searchClear?.addEventListener('click', () => {
  if (ui.searchInput) {
    ui.searchInput.value = '';
    performSearch('');
    ui.searchInput.focus();
  }
});

// --- events ---------------------------------------------------------------

ui.newBtn.addEventListener('click', async () => {
  await flushSave();
  const post = await api('POST', '/api/posts', { title: '', content: '' });
  current = post;
  mergeSummary(post);
  setSaveState('saved');
  renderEditor();
  renderList();
  closePosts();
  ui.title.focus();
});

ui.title.addEventListener('input', scheduleSave);
ui.content.addEventListener('input', () => {
  updateWordCount();
  refreshPreview(); // live preview — no-op in edit mode
  scheduleSave();
});

for (const btn of document.querySelectorAll('.mode-btn')) {
  btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
}

ui.publishBtn.addEventListener('click', async () => {
  if (!current) return;
  await flushSave();
  current = await api('POST', `/api/posts/${current.id}/publish`);
  mergeSummary(current);
  renderEditor();
});

ui.scheduleBtn.addEventListener('click', async () => {
  if (!current) return;
  await flushSave();
  if (current.status === 'scheduled') {
    current = await api('DELETE', `/api/posts/${current.id}/schedule`);
  } else {
    const value = ui.scheduleAt.value;
    if (!value) { ui.scheduleAt.focus(); return; }
    current = await api('POST', `/api/posts/${current.id}/schedule`, { publish_at: toUtcIso(value) });
  }
  mergeSummary(current);
  renderEditor();
});

ui.deleteBtn.addEventListener('click', async () => {
  if (!current || !confirm(`Delete “${current.title || 'Untitled'}”?`)) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const index = posts.findIndex((p) => p.id === current.id);
  await api('DELETE', `/api/posts/${current.id}`);
  posts = posts.filter((p) => p.id !== current.id);
  current = null;
  const next = posts[index] || posts[posts.length - 1];
  if (next) await selectPost(next.id);
  else {
    renderEditor();
    renderList();
  }
});

ui.shortcutsToggle?.addEventListener('click', () => toggleShortcutsModal(true));
ui.modalClose?.addEventListener('click', () => toggleShortcutsModal(false));
ui.shortcutsModal?.addEventListener('click', (e) => {
  if (e.target === ui.shortcutsModal) toggleShortcutsModal(false);
});

ui.historyBtn?.addEventListener('click', () => openHistory());
ui.historyClose?.addEventListener('click', () => closeHistory());
ui.historyRestore?.addEventListener('click', () => restoreRevision());
ui.historyModal?.addEventListener('click', (e) => {
  if (e.target === ui.historyModal) closeHistory();
});

ui.focusBtn?.addEventListener('click', () => toggleFocusMode());

ui.postsBtn?.addEventListener('click', () => {
  if (ui.drawer.classList.contains('open')) closePosts();
  else openPosts();
});
ui.moreBtn?.addEventListener('click', () => {
  if (ui.moreMenu.classList.contains('open')) closeMore();
  else openMore();
});
ui.fontIncreaseBtn?.addEventListener('click', () => setFontSize(fontSize + 2));
ui.fontDecreaseBtn?.addEventListener('click', () => setFontSize(fontSize - 2));
for (const btn of ui.widthButtons) {
  btn?.addEventListener('click', () => setTypeWidth(btn.dataset.width));
}
ui.targetWords?.addEventListener('input', () => {
  updateGoal();
  scheduleSave();
});

document.addEventListener('click', (e) => {
  if (ui.drawer.classList.contains('open') && !ui.drawer.contains(e.target) && e.target !== ui.postsBtn) {
    closePosts();
  }
  if (ui.moreMenu.classList.contains('open') && !ui.moreMenu.contains(e.target) && e.target !== ui.moreBtn) {
    closeMore();
  }
});

document.addEventListener('keydown', (e) => {
  const isInput = ['INPUT', 'TEXTAREA'].includes(e.target?.tagName);
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    toggleFocusMode();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    ui.newBtn.click();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openPosts();
  } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    save();
  } else if ((e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=')) {
    e.preventDefault();
    setFontSize(fontSize + 2);
  } else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
    e.preventDefault();
    setFontSize(fontSize - 2);
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    if (current) cycleViewMode();
  } else if ((e.key === '?' && !isInput) || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
    e.preventDefault();
    toggleShortcutsModal();
  } else if (e.key === 'Escape') {
    if (!ui.shortcutsModal.hidden) {
      e.preventDefault();
      toggleShortcutsModal(false);
    } else if (ui.historyModal && !ui.historyModal.hidden) {
      e.preventDefault();
      closeHistory();
    } else if (ui.drawer.classList.contains('open')) {
      e.preventDefault();
      closePosts();
    } else if (ui.moreMenu.classList.contains('open')) {
      e.preventDefault();
      closeMore();
    } else if (focusMode) {
      e.preventDefault();
      toggleFocusMode(false);
    }
  }
});

window.addEventListener('beforeunload', () => {
  if (saveTimer) save();
});

// --- theme ----------------------------------------------------------------

const THEME_KEY = 'inkwell-theme';
const themeBtn = el('theme-toggle');

function availableThemes() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--themes');
  const names = raw.trim().split(/\s+/).filter(Boolean);
  return names.length ? names : ['dark'];
}

function currentTheme(themes) {
  const t = document.documentElement.getAttribute('data-theme');
  return t && themes.includes(t) ? t : themes[0];
}

function applyTheme(name, themes) {
  if (name === themes[0]) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', name);
  }
  localStorage.setItem(THEME_KEY, name);
  if (themeBtn) {
    const next = themes[(themes.indexOf(name) + 1) % themes.length];
    themeBtn.textContent = next === 'light' ? '☀' : '☾';
    themeBtn.title = `Switch to ${next} theme`;
    themeBtn.setAttribute('aria-label', `Switch to ${next} theme`);
  }
}

(function initTheme() {
  const themes = availableThemes();
  const stored = localStorage.getItem(THEME_KEY);
  const startTheme = stored && themes.includes(stored) ? stored : themes[0];
  applyTheme(startTheme, themes);
  themeBtn?.addEventListener('click', () => {
    const cur = currentTheme(themes);
    const next = themes[(themes.indexOf(cur) + 1) % themes.length];
    applyTheme(next, themes);
  });
})();

// --- boot -----------------------------------------------------------------

async function start() {
  setViewMode(localStorage.getItem(VIEW_MODE_KEY) || 'edit');
  posts = await api('GET', '/api/posts');
  if (!posts.length) {
    const post = await api('POST', '/api/posts', { title: '', content: '' });
    current = post;
    mergeSummary(post);
    renderEditor();
  } else {
    await selectPost(posts[0].id);
  }
  renderList();
}

start().catch((err) => {
  console.error(err);
  ui.empty.hidden = false;
  ui.empty.textContent = 'Could not reach the server.';
});
