# Redesign Inkwell as a quiet room

## Goal

Redesign Inkwell around one idea: **the app is a quiet room where writing happens.**
Everything that is not the current draft leaves the room until called for.

- The default state is the writing state: one beautiful column of text, generous
  whitespace, calm neutral surfaces, no sidebar, no button strips.
- **Every existing feature stays reachable** — posts list, search, publish,
  delete, themes, view modes, focus mode, font sizing, word goals, reading time,
  shortcuts. Nothing is removed. Nothing new is added.
- Today's always-visible chrome collapses into **two unobtrusive menus**:
  a posts drawer (☰, top-left) and a More menu (⋯, top-right). A writer who wants
  a tool opens a menu; a writer who is writing sees almost nothing.
- Transitions are soft and immediate. Nothing jumps, flashes, or demands attention.

**Important reconciliation with the current codebase:** the previous pass
(`specs/11ee2933_declutter-ui.md`) removed font sizing, word goals, and reading
time from the UI, and `server.test.ts` asserts their absence. This prompt's
keep-list explicitly includes those three features ("font scaling is limited"
is called out as a problem). **This redesign restores them inside menus**, and
the two absence tests are updated to presence tests. Everything else in the
suite stays untouched and green.

## Decisions

### Layout (new)

```
<body>
  <header class="topbar">          ← fixed, 44px, transparent, pointer-events:none
    ☰ (#posts-btn)                 ← opens posts drawer (also ⌘P)
    ⋯ (#more-btn)                  ← opens More menu
  </header>

  <main class="editor" id="editor" hidden>   ← unchanged panes/title, full width
    <input id="title">
    <div id="panes"> textarea + preview </div>
    <footer class="footer">        ← readouts only, no buttons
      #word-count  #reading-time  #save-state   (left, faint)
    </footer>
  </main>

  <p id="empty" class="empty" hidden></p>

  <aside id="posts-drawer" class="sidebar drawer" aria-hidden="true">   ← overlay, slides from left
    brand header (SVG byte-for-byte) · search box · list-head (+ new) · #post-list · #total-posts
  </aside>

  <div id="more-menu" class="popover" role="dialog" aria-hidden="true">  ← top-right popover
    Appearance: theme toggle, text size (A− / A+)
    Writing:    word goal (#target-words + #goal-progress)
    View:       mode-switch (edit/split/preview), focus toggle, shortcuts toggle
    Post:       publish, delete
  </div>

  <div id="shortcuts-modal"> … existing modal, + restored font-size rows + ⌘P row … </div>
</body>
```

- **Posts drawer** (left overlay, `position: fixed`, slides in, `z-index` above
  editor; no layout reflow → nothing jumps). Opens from `#posts-btn` or `⌘P`.
  Closes on: Esc, click outside, or after selecting a post / creating a new one
  (appears on intent, gets out of the way). The drawer is the **only** home of
  the post list, search, `+ new`, and post count.
- **More menu** (top-right popover): the single home for every setting and
  action. Theme, text size, word goal, view mode, focus mode, shortcuts,
  publish, delete. Clicks inside the menu do not close it; Esc or outside click
  closes it.
- **Footer**: passive readouts only — `#word-count`, `#reading-time`
  ("6 min read"), `#save-state`. All buttons leave the footer.
- **Focus mode** keeps its semantics and CSS hooks: hides `.sidebar` (the
  drawer), dims `.footer`, and additionally fades the topbar. `⌘⇧F` / Esc
  unchanged. Opening either menu while in focus mode exits focus mode first.
- **Font size restored**: `A−`/`A+` buttons and `⌘+`/`⌘−` shortcuts; a range
  of sizes (default 18px, e.g. 16/18/20/22/24), persisted in localStorage
  (`inkwell-font-size`), applied via a CSS variable `--editor-font-size`.
- **Word goal restored**: `#target-words` input + `#goal-progress` percentage,
  sent to the server on save as `target_word_count` (server API already
  supports it — `server.ts` untouched). Goal reached styling via `.goal-met`.
- **Reading time restored**: `calcReadingTime(words) = words === 0 ? 0 : Math.ceil(words / 200)`
  (same formula as the server), shown in the footer next to word count.
- **No new colors / no token changes**: the existing `--*` palette already
  passes the WCAG test. Calm comes from layout and reduced chrome, not from new
  hues. All new CSS uses tokens / `color-mix` only.
- **Transitions**: drawer `translateX` + opacity (~220ms ease), popover fade +
  slight translate/scale (~140ms ease), focus-mode fade (~200ms). Add a
  `@media (prefers-reduced-motion: reduce)` block that kills them.
- **No new dependencies**, no build step, `server.ts` and the DB untouched.

## File-by-file changes

### 1. `public/index.html`

- **Brand SVG:** keep `<svg class="brand-icon">` markup **byte-for-byte**
  identical, with `<span>inkwell</span>` beside it, inside
  `<h1 class="brand">` — now in the drawer's `.sidebar-head`. The favicon line
  is untouched.
- **Add the topbar** before `<main>`:
  ```html
  <header class="topbar">
    <button id="posts-btn" class="icon-btn" type="button" aria-label="Posts" title="Posts (⌘P)">☰</button>
    <button id="more-btn" class="icon-btn" type="button" aria-label="More" title="More">⋯</button>
  </header>
  ```
- **Move the current `<aside class="sidebar">`** into the drawer form:
  `<aside id="posts-drawer" class="sidebar drawer" aria-hidden="true">` with the
  same internal order and ids: `.sidebar-head` (brand), `.search-box`
  (`#search-input`, `#search-clear`), `.list-head` (`#new-post`),
  `#post-list`, `.sidebar-footer` — **keep `#total-posts`; remove
  `#theme-toggle` from here** (it moves to the More menu).
  - Do **not** put a `hidden` attribute on the drawer — open/close is driven by
    the `.open` class so transitions can run.
- **Editor footer** — delete `#focus-toggle`, `#shortcuts-toggle`,
  `.mode-switch`, `#publish`, `#delete`. Resulting children (in order):
  `#word-count`, `#reading-time`, `#save-state`, `.spacer`.
  `#reading-time` needs no `hidden` attribute (it's inside the hidden-until-loaded
  editor; JS fills it).
- **Add the More menu** (before the shortcuts modal):
  ```html
  <div id="more-menu" class="popover" role="dialog" aria-hidden="true">
    <section class="menu-section">
      <h3 class="menu-heading">Appearance</h3>
      <div class="menu-row">
        <span class="menu-label">Theme</span>
        <button id="theme-toggle" class="btn" type="button" aria-label="Switch theme"></button>
      </div>
      <div class="menu-row">
        <span class="menu-label">Text size</span>
        <span class="font-row">
          <button id="font-decrease" class="btn" type="button" aria-label="Decrease font size">A−</button>
          <span id="font-size-label" class="meta">18px</span>
          <button id="font-increase" class="btn" type="button" aria-label="Increase font size">A+</button>
        </span>
      </div>
    </section>
    <section class="menu-section">
      <h3 class="menu-heading">Writing</h3>
      <div class="menu-row" id="goal-container">
        <span class="menu-label">Goal</span>
        <input id="target-words" class="goal-input" type="number" min="0" placeholder="words" aria-label="Word goal">
        <span id="goal-progress" class="goal-progress meta">—</span>
      </div>
    </section>
    <section class="menu-section">
      <h3 class="menu-heading">View</h3>
      <div class="mode-switch" role="group" aria-label="View mode">
        <button id="mode-edit" class="btn mode-btn" type="button" data-mode="edit" aria-pressed="true" title="Edit only">edit</button>
        <button id="mode-split" class="btn mode-btn" type="button" data-mode="split" aria-pressed="false" title="Editor + live preview">split</button>
        <button id="mode-preview" class="btn mode-btn" type="button" data-mode="preview" aria-pressed="false" title="Preview only">preview</button>
      </div>
      <div class="menu-row">
        <button id="focus-toggle" class="btn" type="button">focus</button>
        <button id="shortcuts-toggle" class="btn" type="button">shortcuts</button>
      </div>
    </section>
    <section class="menu-section">
      <h3 class="menu-heading">Post</h3>
      <div class="menu-row">
        <button id="publish" class="btn" type="button">publish</button>
        <button id="delete" class="btn btn-danger" type="button">delete</button>
      </div>
    </section>
  </div>
  ```
  (Keep the same `data-mode` attrs, ids, and classes as today — tests and the
  `querySelectorAll('.mode-btn')` wiring depend on them.)
- **Shortcuts modal:** keep it as-is, plus:
  - restore the two rows `Increase font size` (`⌘ +` / `Ctrl +`) and
    `Decrease font size` (`⌘ −` / `Ctrl −`),
  - add a row `Open posts panel` (`⌘ P` / `Ctrl P`).
  Keep the `Cycle view mode` row and every existing row.

### 2. `public/style.css`

- Keep `:root` tokens **exactly as-is** (the WCAG test parses `--bg`,
  `--bg-sidebar`, `--border`, `--text-faint`, `--text-dim` and checks contrast;
  `--themes: dark light` must stay). Add one new default:
  `--editor-font-size: 18px;` in `:root`.
- **Add new sections between the sidebar section and the editor section**
  (i.e., **before** the `/* --- view modes */` marker — everything after that
  marker is asserted hex/rgba-free; new rules use tokens/`color-mix` only, but
  placing them before the marker keeps that test trivially safe):

  `/* --- quiet room: topbar --- */`
  ```css
  .topbar {
    position: fixed; top: 0; left: 0; right: 0;
    height: 44px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 14px;
    z-index: 400;
    pointer-events: none; /* empty bar never blocks the editor */
  }
  .topbar .icon-btn { pointer-events: auto; }
  .icon-btn {
    width: 30px; height: 30px;
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 6px;
    background: transparent;
    color: var(--text-faint);
    font-size: 15px; line-height: 1;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }
  .icon-btn:hover { color: var(--text); background: var(--surface-2); }
  ```

  `/* --- quiet room: drawer --- */`
  ```css
  .drawer {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: 264px;
    flex: none;               /* overrides .sidebar flex basis */
    z-index: 600;
    transform: translateX(-100%);
    visibility: hidden;
    opacity: 0;
    box-shadow: var(--shadow-modal);
    transition: transform 0.22s ease, opacity 0.22s ease, visibility 0.22s ease;
  }
  .drawer.open { transform: none; visibility: visible; opacity: 1; }
  ```

  `/* --- quiet room: popover --- */`
  ```css
  .popover {
    position: fixed; top: 46px; right: 12px;
    width: 264px;
    z-index: 700;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow-modal);
    padding: 8px;
    opacity: 0; visibility: hidden;
    transform: translateY(-6px) scale(0.98);
    transform-origin: top right;
    transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s ease;
  }
  .popover.open { opacity: 1; visibility: visible; transform: none; }
  .menu-section { padding: 10px 8px; border-bottom: 1px solid var(--border); }
  .menu-section:last-child { border-bottom: 0; }
  .menu-heading { margin: 0 0 8px; font-family: var(--sans); font-size: 10.5px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--text-faint); }
  .menu-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; }
  .menu-label { font-size: 13px; color: var(--text-dim); }
  .font-row { display: inline-flex; align-items: center; gap: 6px; }
  .goal-input { width: 64px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-1); color: var(--text); font-family: inherit; font-size: 12.5px; }
  .goal-progress { min-width: 34px; text-align: right; }
  .goal-met { color: var(--accent); }
  #more-menu .mode-switch { width: 100%; justify-content: space-between; margin-bottom: 8px; }
  ```

  `/* --- quiet room: motion --- */`
  ```css
  @media (prefers-reduced-motion: reduce) {
    .drawer, .popover, .footer, .topbar, .icon-btn { transition: none !important; }
  }
  ```

- **Editor breathing room:** in the existing editor rules change
  `.content` and `.preview` `font-size: 18px` → `font-size: var(--editor-font-size, 18px)`
  and bump `line-height` 1.7 → 1.75–1.8; give `.title` a touch more top space
  (e.g. `padding-top: 64px`) and `.content`/`.preview` more bottom padding
  (e.g. `padding-bottom: 56px`). Keep `max-width: 720px`, the `0 40px` side
  padding, and the `:focus` outline rules.
- **Footer:** keep the `.footer` rule and the focus-mode rules
  (`body.focus-mode .sidebar`, `body.focus-mode .footer`, hover rule) exactly —
  the tests assert those selector strings, and `.sidebar` now names the drawer.
  Add to the focus-mode block: `body.focus-mode .topbar { opacity: 0; pointer-events: none; }`.
- **Focus-visible:** extend the existing `:focus-visible` selector list with
  `.icon-btn:focus-visible`, `.goal-input:focus-visible`, and the menu buttons
  so every new control gets the accent outline.
- Delete now-unused rules if any element is gone (`.search-clear` is still
  used; the old `.btn` rules are still used by menu buttons — keep them).
  Do **not** delete `.sidebar`, `.sidebar-head`, `.brand`, `.search-box`,
  `.search-input`, `.search-clear`, `.list-head`, `.new-btn`, `.post-list`,
  `.sidebar-footer`, `.post-item`, `.dot`, `.mode-switch`, `.btn`, `.meta`.

### 3. `public/app.js`

Keep intact (tests load them by exact string):
- the section markers `// --- markdown ---`, `// --- view mode (pure) ---`,
  `// --- view mode (dom) ---` and their contents (`renderMarkdown`,
  `VIEW_MODES`, `normalizeViewMode`, `nextViewMode`, `viewModeShowsPreview`,
  `setViewMode`, `refreshPreview`, `cycleViewMode`);
- `document.body.dataset.viewMode`, the `.mode-btn` loop, the content input
  handler (must still call `refreshPreview()`);
- the strings `e.key.toLowerCase() === 'n'`, `e.key === '?'`,
  `e.key === 'Escape'`, `e.shiftKey && e.key.toLowerCase() === 'f'`,
  `e.key === 'Enter'`, `toggleShortcutsModal`, `toggleFocusMode`,
  `performSearch`, `searchInput`, `searchClear`, `/api/posts?q=`,
  `inkwell-theme`, `availableThemes`, `applyTheme`, `cycleViewMode`.
- Do **not** introduce the strings `showPreview` or `previewing`.

Changes:
- **`ui` map:** add `postsBtn: el('posts-btn')`, `moreBtn: el('more-btn')`,
  `drawer: el('posts-drawer')`, `moreMenu: el('more-menu')`,
  `fontIncreaseBtn: el('font-increase')`, `fontDecreaseBtn: el('font-decrease')`,
  `fontSizeLabel: el('font-size-label')`, `readingTime: el('reading-time')`,
  `targetWords: el('target-words')`, `goalProgress: el('goal-progress')`,
  `goalContainer: el('goal-container')`. (Remove `searchInput`? no — keep;
  `focusBtn`, `shortcutsToggle`, `publishBtn`, `deleteBtn` now point into the
  menu — the ids are unchanged so `el()` still resolves them.)
- **Font size (restore):**
  ```js
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
  ```
  Init: read `localStorage.getItem(FONT_SIZE_KEY)`, clamp into `FONT_SIZES`,
  `applyFontSize()`. Listeners: `fontIncreaseBtn` → `setFontSize(fontSize + 2)`,
  `fontDecreaseBtn` → `setFontSize(fontSize - 2)`.
- **Reading time (restore):**
  ```js
  const calcReadingTime = (words) => (words === 0 ? 0 : Math.ceil(words / 200));
  ```
  In `updateWordCount()`: `ui.readingTime.textContent = minutes ? \`${minutes} min read\` : '';`
- **Word goal (restore):** in `renderEditor()` set
  `ui.targetWords.value = current.target_word_count ?? 0;` then call the goal
  updater. Add:
  ```js
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
  ```
  Call it from `updateWordCount()` and from the `ui.targetWords` input listener
  (which also calls `scheduleSave()`).
- **`save()`:** include the goal — PUT body becomes
  `{ title: ui.title.value, content: ui.content.value, target_word_count: Number(ui.targetWords.value) || 0 }`.
- **Drawer / menu open-close:**
  ```js
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
  ```
  Wire: `postsBtn` click toggles `openPosts`/`closePosts`; `moreBtn` click
  toggles `openMore`/`closeMore`. Add one document click-outside listener that
  closes each open overlay when the click is outside it and not on its trigger.
  After `selectPost()` and after the `newBtn` handler, call `closePosts()`.
- **Esc handler:** extend the existing branch, preserving order —
  shortcuts modal → `closePosts()` → `closeMore()` → exit focus mode. Keep the
  existing modal and focus branches first so the current tests' strings stay.
- **New shortcut:** in the keydown handler add
  `else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); openPosts(); }`.
- **Font-size shortcuts:** add `(e.metaKey || e.ctrlKey) && (e.key === '+' || e.key === '=')`
  → `setFontSize(fontSize + 2)`, and `(e.metaKey || e.ctrlKey) && e.key === '-'`
  → `setFontSize(fontSize - 2)` (both `preventDefault()`).
- Boot flow unchanged: `start()` still loads posts, auto-selects the latest,
  renders the editor; the drawer and More menu simply start closed.

### 4. `server.test.ts`

Update exactly these two tests (the feature keep-list reverses the old
removals); add two or three lock-in tests; leave the other 28 untouched:

1. **"index.html omits writing goal, reading time, and font size elements"** →
   rename to **"index.html contains writing goal, reading time, and font size
   elements"**; assert presence: `id="target-words"`, `id="reading-time"`,
   `id="font-increase"`, `id="font-decrease"`, `id="word-count"`.
2. **"app.js omits reading time calculation and writing goal logic"** →
   rename to **"app.js contains reading time calculation and writing goal
   logic"**; assert presence: `calcReadingTime`, `goalProgress`, `setFontSize`,
   `target_word_count` (already appears via `mergeSummary` — fine).
3. **New: "index.html contains the quiet-room chrome"** — assert
   `id="posts-btn"`, `id="more-btn"`, `id="posts-drawer"`,
   `id="more-menu"`, `class="drawer"`, `class="popover"`.
4. **New: "app.js opens and closes the posts drawer and more menu"** — assert
   `openPosts`, `closePosts`, `openMore`, `closeMore`,
   `e.key.toLowerCase() === 'p'`.
5. **New (recommended): "style.css contains quiet-room drawer and popover
   styles"** — assert `.drawer`, `.popover`, `translateX(-100%)`,
   `prefers-reduced-motion`.

Do **not** touch: the API tests, view-mode/markdown section tests, shortcuts
modal test (`<kbd>` + no `key-hint`), focus-mode tests, search tests, brand/SVG
tests, theme tests, or the WCAG test. The mode buttons keep their ids, so
"index.html exposes the panes and the three mode buttons" keeps passing even
though the switch now lives in the menu.

### 5. `README.md`

- **Keyboard Shortcuts:** add `Cmd+P` / `Ctrl+P` (Open posts panel) and restore
  the `Cmd+` / `Ctrl+` and `Cmd−` / `Ctrl−` font-size rows; note Esc also closes
  the drawer and More menu.
- Replace the **Sidebar UI** and **Editor Footer** bullets with a "Quiet room
  layout" section: default state = writing column; the posts drawer (☰ or ⌘P)
  holds search, + new, the post list, and post count; the More menu (⋯) holds
  theme, text size, word goal, view-mode switch, focus, shortcuts, publish, and
  delete; the footer shows only word count, reading time, and save status.
- **View Modes:** note the mode switch now lives in the More menu; `Cmd+Enter`
  cycling unchanged.
- Leave the API table and tech-stack lines untouched.

## Test-pinning constraints (do not break these)

- Brand SVG markup byte-for-byte identical; no `&#9998;`.
- `id="panes"` before `id="content"` before `id="preview"`; `#preview` has no
  `hidden` attribute.
- `id="mode-edit|mode-split|mode-preview"` with `data-mode` attrs inside
  `class="mode-switch"`; "Cycle view mode" text in the modal.
- `id="shortcuts-modal"`, `id="shortcuts-toggle"`, `id="modal-close"`, `<kbd>`
  present; no `key-hint` string anywhere.
- `id="focus-toggle"` + "Toggle focus mode" (the modal row provides the
  string); `toggleFocusMode` and `e.shiftKey && e.key.toLowerCase() === 'f'`.
- CSS keeps `body.focus-mode .sidebar` and `body.focus-mode .footer` selector
  strings; `:focus-visible` present; `--themes: dark light`;
  `[data-theme="light"]`; the `/* --- view modes */` marker with no hex/rgba
  after it; token values unchanged (WCAG).
- HTML keeps `class="search-box"`, `id="search-input"`, `id="search-clear"`,
  `class="list-head"`, `id="new-post"`, `class="new-btn"`, `id="post-list"`,
  and the order search-box < list-head < post-list with `new-post` between
  list-head and post-list.
- CSS keeps `.brand-icon`, `.brand`, `.list-head`, `display: inline-flex`,
  `align-items: center`.
- `--themes: dark light` and the `inkwell-theme` localStorage key.

## Verification

1. `bun test` — all tests pass (the two updated + the new ones + the 28
   unchanged).
2. `bun run server.ts` and open http://localhost:4501; click through:
   - Boot lands on the latest draft with **no sidebar**: topbar with ☰ and ⋯,
     centered text column, faint footer (`0 words · saved`).
   - `☰` / `⌘P` slides the drawer in; typing filters the list; clicking a post
     loads it and the drawer closes; search clear restores the list.
   - `⌘N` creates a draft, drawer closes, title focused.
   - `⋯` opens the More menu: theme toggles dark/light with correct icon;
     `A−`/`A+` and `⌘+`/`⌘−` resize the text (persists across reload); setting a
     word goal shows live `%` progress and saves `target_word_count` to the DB;
     mode buttons cycle edit/split/preview and `⌘↵` still cycles; focus toggle
     works; shortcuts opens the modal; publish/unpublish and delete work.
   - `⌘⇧F` hides the topbar and drawer and dims the footer; Esc exits focus.
   - `?` / `⌘/` opens the shortcuts modal with the restored font-size rows and
     the new ⌘P row.
   - Esc closes modal → drawer → More menu in that order; clicking outside a
     menu closes it; clicks inside menus never close them.
   - Reload keeps theme, text size, and view mode.
   - With "reduce motion" enabled in the OS, no animation runs.
3. Confirm no console errors and no layout jump when the drawer opens/closes
   (it is an overlay).

## Out of scope / do not touch

- `server.ts` and the DB schema — no API changes. `/api/posts/:id/stats` and
  `target_word_count` support already exist and stay.
- The markdown renderer, view-mode pure logic, autosave/search/publish flows,
  theme tokens, brand SVG markup.
- No new dependencies, no build tooling, no HTML/CSS frameworks.
