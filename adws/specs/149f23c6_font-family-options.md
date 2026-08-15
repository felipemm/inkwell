# Font family options in the More menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Font picker to the More menu's Appearance section with 12 system font choices for the writing surfaces (title, editor textarea, live preview), persisted across reloads.

**Architecture:** Mirror the existing font-size / type-width pattern exactly: a CSS custom property (`--editor-font`) drives the font family of the shared `.title, .content, .preview` rule; a `<select id="font-select">` in the `#more-menu` Appearance section lists 12 named font stacks; `app.js` maps each option value → stack, writes the custom property on `document.documentElement`, syncs the select, and persists the choice under the `inkwell-font-family` localStorage key. Default is `serif` — identical to today's `var(--serif)` rendering, so existing users see no change.

**Tech Stack:** Vanilla JS, CSS custom properties, localStorage (same as the existing theme / font-size / type-width settings). Zero dependencies — the 12 options are system font stacks; no web fonts, no imports, no new files.

**Spec:** `adws/specs/149f23c6_font-family-options.md` (this document, also at the session `context_handoff/plan.md`).

## Global Constraints

- **Zero new dependencies** — font options must be system font stacks only (repo README: "zero dependencies"). Do not add font files or web-font imports.
- Follow the established persistence pattern: localStorage key `inkwell-font-family`, default `serif`.
- The default must render exactly as today (serif stack) so existing users see no change.
- Only the writing surfaces change family: `.title`, `.content`, `.preview`. The chrome (sidebar, `.brand`, menus, buttons) keeps its current families.
- All tests live in `src/server.test.ts` as served-content presence assertions (repo convention).
- Judge commands by exit status, never by scanning output text. `bun test` must exit 0.

## File Structure

| File | Change |
| --- | --- |
| `src/public/index.html` | Add a Font row with `<select id="font-select">` (12 options) to the Appearance section of `#more-menu`. |
| `src/public/style.css` | Add `--editor-font` to `:root`; use it in the `.title, .content, .preview` rule; style `.font-select`. |
| `src/public/app.js` | Add `fontSelect` to the `ui` object; new "quiet room: font family" DOM section (FONTS map, apply/set/init); change listener. |
| `src/server.test.ts` | Three new presence tests (index.html / style.css / app.js). |

This is a frontend-only change: no server routes, no DB schema, no API changes.

---

### Task 1: Font picker markup in index.html

**Files:**
- Modify: `src/public/index.html` — Appearance `<section class="menu-section">` of `#more-menu`, between the Text size row and the Width row
- Test: `src/server.test.ts` (new presence test)

**Interfaces:**
- Produces: `<select id="font-select" class="font-select">` whose `<option value="…">` values are exactly the FONTS keys used in Task 3: `serif, sans, mono, georgia, garamond, palatino, bookantiqua, didot, baskerville, courier, trebuchet, verdana`.

- [ ] **Step 1: Add the failing presence test**

In `src/server.test.ts`, directly after the test `"app.js contains reading time calculation and writing goal logic"` (which ends around line 462, before `"index.html contains the quiet-room chrome"` at line 464), add:

```ts
test("index.html contains the font family picker with at least 10 options", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('id="font-select"');
  expect(text).toContain('class="font-select"');
  expect(text).toContain('aria-label="Editor font"');
  const optionCount = (text.match(/<option value="/g) ?? []).length;
  expect(optionCount).toBeGreaterThanOrEqual(10);
  expect(text).toContain('value="serif"');
  expect(text).toContain('value="mono"');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — `id="font-select"` not found. (There are no other `<option>` elements in index.html, so the count assertion is unambiguous.)

- [ ] **Step 3: Add the Font row to index.html**

In `src/public/index.html`, inside `#more-menu` → Appearance `<section class="menu-section">`, between the Text size `.menu-row` (the `#font-increase` row) and the Width `.menu-row`, add:

```html
<div class="menu-row">
  <span class="menu-label">Font</span>
  <select id="font-select" class="font-select" aria-label="Editor font">
    <option value="serif">Serif</option>
    <option value="sans">Sans</option>
    <option value="mono">Mono</option>
    <option value="georgia">Georgia</option>
    <option value="garamond">Garamond</option>
    <option value="palatino">Palatino</option>
    <option value="bookantiqua">Book Antiqua</option>
    <option value="didot">Didot</option>
    <option value="baskerville">Baskerville</option>
    <option value="courier">Courier</option>
    <option value="trebuchet">Trebuchet MS</option>
    <option value="verdana">Verdana</option>
  </select>
</div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/public/index.html src/server.test.ts
git commit -m "feat: add font picker markup to the More menu"
```

---

### Task 2: Font variable and select styling in style.css

**Files:**
- Modify: `src/public/style.css` — three spots: `:root`, the `.title, .content, .preview` rule, and a new `.font-select` rule
- Test: `src/server.test.ts` (new presence test)

**Interfaces:**
- Produces: `--editor-font` custom property defaulting to `var(--serif)`; `.font-select` styling class (applied to the Task 1 select).

- [ ] **Step 1: Add the failing presence test**

In `src/server.test.ts`, directly after the Task 1 test, add:

```ts
test("style.css defines the editor font variable and the font select style", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("--editor-font: var(--serif)");
  expect(text).toContain("font-family: var(--editor-font, var(--serif))");
  expect(text).toContain(".font-select");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — `--editor-font` not present.

- [ ] **Step 3: Implement the CSS changes**

(a) In `:root`, directly after `--editor-max-width: 1118px;` add:

```css
--editor-font: var(--serif);
```

(b) In the shared `.title, .content, .preview` rule, change `font-family: var(--serif);` to:

```css
font-family: var(--editor-font, var(--serif));
```

(c) Add a `.font-select` rule near the `.goal-input` rule (after the `#more-menu .width-switch` / `.width-switch` block):

```css
.font-select {
  max-width: 132px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-1);
  color: var(--text);
  font-family: inherit;
  font-size: 12.5px;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/public/style.css src/server.test.ts
git commit -m "feat: drive editor font family from a CSS variable"
```

---

### Task 3: Font family logic in app.js

**Files:**
- Modify: `src/public/app.js` — three spots: the `ui` object, a new section after the type-width section, and an event listener
- Test: `src/server.test.ts` (new presence test)

**Interfaces:**
- Consumes: `ui.fontSelect` (Task 1's `#font-select`); `--editor-font` (Task 2).
- Produces: `FONTS` map (keys = option values from Task 1), `setFontFamily(name)`, `applyFontFamily()`, localStorage key `inkwell-font-family`.

- [ ] **Step 1: Add the failing presence test**

In `src/server.test.ts`, directly after the Task 2 test, add:

```ts
test("app.js contains font family logic and persistence", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("const FONTS");
  expect(text).toContain("inkwell-font-family");
  expect(text).toContain("setFontFamily");
  expect(text).toContain("applyFontFamily");
  expect(text).toContain("--editor-font");
  expect(text).toContain("ui.fontSelect");
  expect(text).toContain('ui-serif, Georgia, "Iowan Old Style"');
  expect(text).toContain('"Courier New", Courier, monospace');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — `const FONTS` not found.

- [ ] **Step 3: Implement the app.js changes**

(a) In the `ui` object, directly after `widthButtons: Array.from(document.querySelectorAll('.width-btn')),` add:

```js
fontSelect: el('font-select'),
```

(b) Add a new section immediately after the `initTypeWidth` IIFE (end of the `// --- quiet room: type width ---` section, before the `// --- history (pure) ---` section):

```js
// --- quiet room: font family ----------------------------------------------

const FONTS = {
  serif: 'ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: 'ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  georgia: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  garamond: 'Garamond, "EB Garamond", "Cormorant Garamond", "Times New Roman", serif',
  palatino: 'Palatino, "Palatino Linotype", "Book Antiqua", serif',
  bookantiqua: '"Book Antiqua", Palatino, "Palatino Linotype", serif',
  didot: 'Didot, "Bodoni MT", "Playfair Display", "Times New Roman", serif',
  baskerville: 'Baskerville, "Baskerville Old Face", "Hoefler Text", Garamond, "Times New Roman", serif',
  courier: '"Courier New", Courier, monospace',
  trebuchet: '"Trebuchet MS", "Lucida Grande", "Segoe UI", sans-serif',
  verdana: 'Verdana, Geneva, "Segoe UI", sans-serif',
};
const FONT_FAMILY_KEY = 'inkwell-font-family';
let fontFamily = 'serif';

function applyFontFamily() {
  document.documentElement.style.setProperty('--editor-font', FONTS[fontFamily]);
  if (ui.fontSelect) ui.fontSelect.value = fontFamily;
  localStorage.setItem(FONT_FAMILY_KEY, fontFamily);
}

function setFontFamily(name) {
  if (FONTS[name]) { fontFamily = name; applyFontFamily(); }
}

(function initFontFamily() {
  const stored = localStorage.getItem(FONT_FAMILY_KEY);
  fontFamily = FONTS[stored] ? stored : 'serif';
  applyFontFamily();
})();
```

(c) Add the change listener next to the other font listeners, directly after `ui.fontDecreaseBtn?.addEventListener('click', () => setFontSize(fontSize - 2));`:

```js
ui.fontSelect?.addEventListener('change', (e) => setFontFamily(e.target.value));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/public/app.js src/server.test.ts
git commit -m "feat: add font family selection with persistence"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `bun test`
Expected: exit 0, all tests pass.

- [ ] **Step 2: Syntax-check app.js**

Run: `node --check src/public/app.js`
Expected: exit 0. (Guards against duplicate top-level declarations — the regression class from `adws/specs/df0335e6_fix-duplicate-escapehtml.md`.)

- [ ] **Step 3: Manual smoke test**

Run: `bun run dev`, open `http://localhost:4501`, open the `⋯` menu, find the **Font** select in the Appearance section.

1. The select shows **Serif** by default and the writing column renders in the serif stack (unchanged from before).
2. Choose **Mono** → title, textarea, and preview (switch to preview/split mode too) all switch to a monospace family.
3. Reload the page → **Mono** is still selected and applied.
4. Choose each of the other options — all 12 render and the select reflects the choice.
5. Clear the setting (`localStorage.removeItem('inkwell-font-family')` in devtools) and reload → back to **Serif**.
6. The sidebar brand, menus, and buttons keep their original fonts (only writing surfaces change).

- [ ] **Step 4: Commit any leftover fixups** (only if a step above surfaced a bug)

```bash
git add -A
git commit -m "fix: font family follow-ups"
```

---

## Self-Review

- **Spec coverage:** request = "add option to change the font, give at least 10 options". Task 1 adds the picker UI; Task 3 provides 12 options (≥ 10); Tasks 2–3 wire it to the editor surfaces. ✓
- **Placeholder scan:** every step contains concrete code or exact commands; no TBD/TODO. ✓
- **Type consistency:** option values in Task 1 (`serif`…`verdana`) match the FONTS keys in Task 3; `--editor-font` is spelled identically in Tasks 2 and 3; `inkwell-font-family` is used in both the Task 3 implementation and its test; `setFontFamily`/`applyFontFamily` names match between the Task 3 test and implementation. ✓
