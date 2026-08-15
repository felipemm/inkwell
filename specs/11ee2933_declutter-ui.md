# Declutter the inkwell UI

## Goal

The inkwell editor has accumulated too much chrome: the writing surface is
surrounded by secondary controls and status readouts that distract from
writing. Make the UI noticeably cleaner by **removing** the noisy,
rarely-used elements — no new features, no server changes. The app stays a
minimalist blog writer: post list, editor, one-click publish.

## Decisions (what goes, what stays)

**Remove from the UI:**
- Font size controls: `A-` / `A+` buttons, the `⌘+` / `⌘-` shortcuts, the
  modal rows, `setFontSize` + `fontSize` state, the font-size styling hook.
- Writing-goal cluster: `Goal:` label, `#target-words` input, `#goal-progress`
  percentage, `.goal-met` styling, all goal JS. The client stops sending
  `target_word_count` (the server and DB column stay untouched — API tests keep passing).
- Reading time in the editor footer (`#reading-time`, `calcReadingTime`).
  The server's `/api/posts/:id/stats` `reading_minutes` stays — API untouched.
- All `<kbd class="key-hint">` chips on buttons (`⌘N`, `⌘-`, `⌘+`, `⌘⇧F`, `?`,
  `⌘↵`). The shortcuts modal (`?` / `⌘/`) is the single home for key info.
- Sidebar footer word aggregate (`#total-words`). Keep the post count.
- Live search matches count (`#search-count` span + wiring). Keep the search
  input and clear button — the result list itself is the feedback.

**Keep (these are the writing essentials):**
- Search input + clear button, post list (status dot / title / relative time).
- `+ new` button (without the kbd chip), `#total-posts` count.
- Editor footer, slimmed to: `#word-count`, `#save-state` on the left; on the
  right `#focus-toggle`, `#shortcuts-toggle`, the edit/split/preview
  `.mode-switch` (cycle `⌘↵` still works), `#publish`, `#delete`.
- Focus mode (button, `⌘⇧F`, Esc exits) — it is the app's built-in distraction killer.
- Shortcuts modal and all its shortcuts minus the two font-size rows.
- Theme toggle — restyled from a text label ("light") to an icon button
  (sun ☀ when switching to light, moon ☾ when switching to dark) with
  `title`/`aria-label`. Keeps `id="theme-toggle"`.
- All server behavior, the markdown renderer, view modes, autosave, theme
  tokens (`--themes: dark light`), and the brand SVG markup (see constraints).

## File-by-file changes

### 1. `public/index.html`

- **Brand:** keep the `<svg class="brand-icon">` markup byte-for-byte identical
  (a test asserts its internals). Shrink visually via CSS only (step 2).
- **Sidebar footer:** delete `<span id="total-words" class="meta"></span>`.
  Replace the theme toggle button body with an icon:
  `<button id="theme-toggle" class="btn" type="button" aria-label="Switch theme"></button>`
  (JS fills glyph + title, see step 3).
- **Sidebar search box:** delete `<span id="search-count" class="search-count" hidden></span>`.
- **List head:** delete the kbd chip from the new button:
  `<button id="new-post" class="new-btn" type="button">+ new</button>`.
- **Editor footer:** delete `#reading-time`, the whole `#goal-container` block,
  `#font-decrease`, `#font-increase`. Delete every `<kbd class="key-hint">`
  from `#focus-toggle`, `#shortcuts-toggle`, and the `.mode-switch`.
  Resulting footer children (in order):
  `#word-count`, `#save-state`, `.spacer`, `#focus-toggle`, `#shortcuts-toggle`,
  `.mode-switch` (edit/split/preview only), `#publish`, `#delete`.
- **Shortcuts modal:** delete the "Increase font size" and "Decrease font size"
  `<li>` rows. Everything else stays.

### 2. `public/style.css`

- Add a small rule to slim the brand, e.g.
  `.brand { font-size: 20px; } .brand-icon { width: 22px; height: 22px; }`
  (do not touch the SVG internals in HTML).
- Delete rules for removed elements: `.search-count`, `.goal-container`,
  `.goal-label`, `.goal-input`, `.goal-progress`, `.goal-met`, and the
  `.key-hint` rule (no element uses it anymore). `.goal-input:focus` goes too.
- Theme toggle icon sizing: `.btn` already applies; add
  `#theme-toggle { font-size: 14px; line-height: 1; }` so the glyph sits well.
- Keep `.footer` height/background and focus-mode rules as-is — the slimmer
  footer reads cleaner with fewer children at the same 44px height.
- Do not introduce new colors — reuse existing `--*` tokens (the WCAG test
  parses `--bg`, `--bg-sidebar`, `--border`, `--text-faint`, `--text-dim` and
  asserts `:focus-visible` exists; keep all of those).

### 3. `public/app.js`

Remove (do not move elsewhere):
- From the `ui` map: `readingTime`, `targetWords`, `goalProgress`,
  `goalContainer`, `fontIncreaseBtn`, `fontDecreaseBtn`, `searchCount`,
  `totalWords`.
- `setFontSize()` and the `fontSize` variable.
- `calcReadingTime()`.
- In `renderEditor()`: the `ui.targetWords.value = ...` line.
- In `updateWordCount()`: the reading-time assignment and the whole
  `target`/`goalProgress`/`goal-met` block. Keep `updateTotals()` call.
- In `updateTotals()`: drop the `ui.totalWords.textContent` line (keep post count).
- In `save()`: stop reading/sending `target_word_count` (send only
  `{ title, content }`).
- In `performSearch()`: the `searchCount` show/hide/text lines.
- Event wiring: the `ui.targetWords` input listener, the
  `ui.fontIncreaseBtn`/`ui.fontDecreaseBtn` click listeners, and the two
  `⌘+` / `⌘-` branches in the `keydown` handler.
- The `searchCount`/`totalWords`/etc. references above.
- In the theme block, `applyTheme()`: replace
  `themeBtn.textContent = next` with an icon glyph, e.g.
  `themeBtn.textContent = next === 'light' ? '☀' : '☾';` and
  `themeBtn.title = \`Switch to ${next} theme\`;` (update the aria-label too
  via `themeBtn.setAttribute('aria-label', ...)`).

Keep intact (tests load these): the `// --- markdown ---` and
`// --- view mode (pure) ---` sections, `nextViewMode`, `normalizeViewMode`,
`setViewMode`, `refreshPreview`, `toggleFocusMode`, `toggleShortcutsModal`,
`performSearch`, the `⌘N`, `⌘S`, `⌘↵`, `?`/`⌘/`, Esc, and `⌘⇧F` handlers,
and the whole theme block (function names `availableThemes` / `applyTheme`
must survive).

### 4. `server.test.ts` — update the static frontend tests

These tests assert the exact clutter being removed; update them to match the
leaner UI. The API tests (lifecycle, stats, tags, search, target_word_count)
are untouched. Edit these tests:

- **"index.html contains shortcuts modal elements and visual key hints"** →
  rename to "...shortcuts modal elements"; assert `id="shortcuts-modal"`,
  `id="shortcuts-toggle"`, `id="modal-close"`, and that the modal uses `<kbd>`
  (e.g. `expect(text).toContain("<kbd>")`); drop the `class="key-hint"`
  assertion (optionally add `expect(text).not.toContain('key-hint')`).
- **"index.html contains focus mode and font size control elements"** → drop
  the `font-increase`, `font-decrease`, "Increase font size",
  "Decrease font size" assertions; keep `focus-toggle` and "Toggle focus mode".
- **"app.js contains focus mode and font size handlers and shortcut listeners"**
  → keep `toggleFocusMode`, `e.shiftKey && e.key.toLowerCase() === 'f'`; drop
  `setFontSize`, `ui.title.style.fontSize`, and the `=`/`+`/`-` key patterns.
- **"index.html contains target word count, reading time, and goal elements"**
  → replace with a lock-in test asserting absence:
  `expect(text).not.toContain('id="target-words"')`,
  `expect(text).not.toContain('id="reading-time"')`,
  `expect(text).not.toContain('id="goal-container"')`. (Keep asserting
  `id="word-count"` presence.)
- **"app.js contains reading time calculation and writing goal logic"** →
  replace with absence assertions: `not.toContain("calcReadingTime")`,
  `not.toContain("goalProgress")`, `not.toContain("goal-met")`.
  (`target_word_count` may still appear via `mergeSummary`; do not assert on it
  either way.)
- **"index.html, app.js, and style.css contain search filter UI elements and
  logic"** → drop the `search-count` assertions in html/js/css (3 lines). Keep
  `search-input`, `search-clear`, `performSearch`, `/api/posts?q=`, `.search-box`.

Do not touch: "index.html contains brand vector icon..." (SVG markup stays),
"style.css contains styles for brand icon...", "theme tokens..." (id stays,
`--themes: dark light` stays), the WCAG test, or any API test.

### 5. `README.md`

- **Keyboard Shortcuts:** remove the "Increase font size" and "Decrease font
  size" rows.
- **Sidebar UI:** remove the "live result count (`#search-count`)" mention;
  note the theme toggle is now an icon button.
- **Editor Footer:** remove reading time, writing target/goal, and font size
  adjusters from the description; keep word count, save status, focus mode,
  shortcuts, view-mode switch, publish/delete.
- Leave the API table and tech-stack lines untouched.

## Out of scope / do not touch

- `server.ts` — no API changes. `/api/posts/:id/stats` still returns
  `reading_minutes`; posts still store `target_word_count`.
- The markdown renderer, view-mode logic, autosave, search API, theme tokens,
  brand SVG markup, `.mode-switch` behavior, focus-mode CSS.
- No new UI features, no layout overhaul (sidebar stays 240px, footer stays
  44px, same colors). This pass is removals + one icon restyle only.

## Verification

1. `bun test` — full suite passes (API tests unchanged; frontend tests updated).
2. `bun run server.ts`, open http://localhost:4501, and click through:
   - Editor loads, typing autosaves ("saved" appears), word count updates.
   - `⌘↵` cycles edit → split → preview; mode buttons work.
   - `⌘⇧F` / focus button hides sidebar and dims footer; Esc exits.
   - `?` opens the shortcuts modal; it no longer lists font-size shortcuts.
   - Search filters and the clear button restores the list; no matches-count line.
   - `+ new` creates a draft; publish/unpublish toggles; delete works.
   - Theme toggle switches dark ↔ light and shows the correct icon + title.
   - No `key-hint` chips anywhere in the UI.
