# Type-area width options in the top-right menu

## Request

> add option to increase the width of the type area, add 3 size options in the top right menu

The **type area** is the centered writing column — `.title`, `.content` and `.preview` all share `max-width: 720px` (`src/public/style.css`, `.title, .content, .preview` rule). The **top right menu** is the `#more-menu` popover opened by the `⋯` button (`#more-btn`) in the topbar.

Add a **Width** control to the menu's Appearance section with **3 size options** (narrow / medium / wide), persisted in `localStorage` like the existing font-size and view-mode settings. The medium option must equal today's 720px so current users see no change by default.

## Approach

Drive the column width with a CSS custom property, exactly like the existing `--editor-font-size` pattern:

- `:root` gets `--editor-max-width: 720px` next to `--editor-font-size`.
- The shared rule's `max-width: 720px` becomes `max-width: var(--editor-max-width)`.
- A new menu row in `#more-menu` (Appearance section, under the Text size row) renders a 3-button segmented control — same visual pattern as the existing edit/split/preview `.mode-switch` — with buttons `narrow`, `medium`, `wide`.
- `app.js` gets a small DOM section that maps each label to a pixel width, writes the custom property on `document.documentElement`, marks the active button, and persists the choice under `inkwell-type-width`.

**Important:** do NOT reuse the `.mode-btn` class on the width buttons. The event binding at `src/public/app.js` (`for (const btn of document.querySelectorAll('.mode-btn'))`) drives view mode from `data-mode`; giving the width buttons that class would hijack the view-mode switch. Use a separate `.width-btn` class and a `.width-switch` container styled like `.mode-switch`.

**Scope note:** in split mode, `.content` / `.preview` intentionally get `max-width: none` (`body[data-view-mode="split"] .content, ... .preview` rule). The width setting therefore affects the single-pane edit and preview views; split view keeps its side-by-side layout. This is acceptable — do not force the width into split mode.

## Files to touch

### 1. `src/public/style.css`

- In `:root` (next to `--editor-font-size: 18px;`):
  ```css
  --editor-max-width: 720px;
  ```
- In the shared `.title, .content, .preview` rule (currently `max-width: 720px;`):
  ```css
  max-width: var(--editor-max-width);
  ```
- After the `#more-menu .mode-switch` rule, add the width-switch styles (mirror the mode-switch ones):
  ```css
  #more-menu .width-switch { width: 100%; justify-content: space-between; }
  .width-switch {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
  }
  ```
  The `.btn.active` rule already styles the selected button (`color: var(--accent)`), so no extra active styling is needed.

### 2. `src/public/index.html`

In the `#more-menu` popover, inside the Appearance `<section class="menu-section">`, after the Text size `.menu-row` (the `#font-increase` row), add:

```html
<div class="menu-row">
  <span class="menu-label">Width</span>
  <span class="width-switch" role="group" aria-label="Type area width">
    <button class="btn width-btn" type="button" data-width="narrow" aria-pressed="false" title="Narrow type area">narrow</button>
    <button class="btn width-btn" type="button" data-width="medium" aria-pressed="true" title="Medium type area">medium</button>
    <button class="btn width-btn" type="button" data-width="wide" aria-pressed="false" title="Wide type area">wide</button>
  </span>
</div>
```

(`aria-pressed` states are provisional; `applyTypeWidth()` in app.js recomputes them on boot.)

### 3. `src/public/app.js`

- Add to the `ui` object (near `fontIncreaseBtn` / `fontDecreaseBtn`):
  ```js
  widthButtons: Array.from(document.querySelectorAll('.width-btn')),
  ```
- Add a new DOM section right after the `// --- quiet room: font size, reading time, goal ---` block (after the `initFontSize` IIFE):

  ```js
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
  ```

- Add the click binding next to the other menu event listeners (near `ui.fontIncreaseBtn?.addEventListener(...)`):
  ```js
  for (const btn of ui.widthButtons) {
    btn?.addEventListener('click', () => setTypeWidth(btn.dataset.width));
  }
  ```
  (`ui.widthButtons` is non-null in the shipped HTML; the `btn?.` guard keeps it defensive.)

This is a DOM section, not a `(pure)` section, so it does not need to be self-contained for the `loadSection` test harness.

### 4. `src/server.test.ts` — presence tests (follow existing conventions)

Add to the existing `"index.html contains writing goal, reading time, and font size elements"` test (or a sibling test right after it) the three data attributes, and to `"app.js contains reading time calculation and writing goal logic"` (or a sibling) the new function names:

```ts
expect(text).toContain('data-width="narrow"');
expect(text).toContain('data-width="medium"');
expect(text).toContain('data-width="wide"');
```

```ts
expect(text).toContain("TYPE_WIDTHS");
expect(text).toContain("setTypeWidth");
expect(text).toContain("applyTypeWidth");
```

These are plain served-content presence checks, matching the existing pattern at `src/server.test.ts:412` and `:420`. Do not add a `loadSection`-based pure test for the width logic — it is DOM code and would not load standalone.

## Verification (judge by exit status, not output text)

1. `bun test` — full suite passes, including the new presence assertions.
2. `node --check src/public/app.js` — exit 0 (module-scope sanity; guards against duplicate top-level declarations, the regression class from `adws/specs/df0335e6_fix-duplicate-escapehtml.md`).
3. Manual smoke: `bun run dev`, open `http://localhost:4501`, open the `⋯` menu, click **narrow** / **medium** / **wide** and confirm the centered writing column (title + textarea in edit mode; preview in preview mode) changes width. Reload the page — the chosen width persists. Switch to split view and confirm the side-by-side layout is unchanged. Default state (no prior setting) is **medium** = current 720px behavior.
