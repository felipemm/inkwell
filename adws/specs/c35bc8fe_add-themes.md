# Add themes to the More menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-state ☀/☾ theme toggle with a five-theme picker (dark, light, sepia, forest, midnight) in the More menu's Appearance section. Existing users keep their saved theme; the default stays dark.

**Architecture:** The app already has a data-driven theme engine: `:root { --themes: dark light; }` lists the available theme names, `[data-theme="light"]` (and friends) override the token block, `app.js` reads `--themes` via `availableThemes()` and writes `data-theme` + the `inkwell-theme` localStorage key. We extend that engine — no new mechanism. The toggle button becomes a `<select id="theme-select">` populated from `--themes` (mirroring the existing `#font-select` pattern), and three new `[data-theme]` token blocks (sepia, forest, midnight) are added. The default (first theme in `--themes`, dark) renders exactly as today — the `data-theme` attribute is only present for non-default themes — so existing users see no change.

**Tech Stack:** Vanilla JS, CSS custom properties, localStorage (same as the existing theme / font-size / font-family / type-width settings). Zero new dependencies, no new files.

**Spec:** `adws/specs/c35bc8fe_add-themes.md` (this document, also at the session `context_handoff/plan.md`).

## Global Constraints

- **Zero new dependencies** — themes are CSS token blocks only (repo README: "zero dependencies"). No color libraries, no JSON theme files.
- **Keep the existing mechanism**: `--themes` in `:root`, `[data-theme="…"]` blocks, `inkwell-theme` localStorage key, `availableThemes()` / `applyTheme()` in app.js. The default is the FIRST name in `--themes`; `applyTheme` removes `data-theme` for the default and sets it otherwise (this exact behavior must be preserved, because the pre-hydration inline script in `index.html` sets `data-theme` from localStorage before CSS loads).
- **Order of `--themes` is `dark light sepia forest midnight`** — `dark` stays first (default) and `light` stays second, so any stored `inkwell-theme=light` keeps working and dark-default users see zero change.
- **Replace, don't duplicate**: the old `#theme-toggle` button goes away entirely (README says "theme toggle (☀/☾)" — the README is updated in Task 4).
- All tests live in `src/server.test.ts` as served-content presence assertions (repo convention).
- Judge commands by exit status, never by scanning output text. `bun test` must exit 0.

## File Structure

| File | Change |
| --- | --- |
| `src/public/index.html` | Replace the Theme button row with a Theme row containing `<select id="theme-select" class="font-select" aria-label="Theme">` (5 options: dark, light, sepia, forest, midnight). The pre-hydration script in `<head>` stays untouched. |
| `src/public/style.css` | `--themes: dark light sepia forest midnight;` and three new token blocks: `[data-theme="sepia"]`, `[data-theme="forest"]`, `[data-theme="midnight"]`. The existing `.font-select` class already styles the select (reuse it, no new CSS rule needed). |
| `src/public/app.js` | Rewrite the `// --- theme ---` section: replace the button/☀☾ icon logic with `populateThemeSelect(themes)`, `setTheme(name, themes)`, and a `change` listener on `#theme-select`. |
| `src/server.test.ts` | Rewrite the existing `"theme tokens, light mode, and theme toggle controls are present"` test into `"theme picker, five themes, and persistence are present"` asserting the new select, all five theme names, and the new app.js functions. |
| `README.md` | Line 40: change "the theme toggle (☀/☾)" to "a theme picker (dark / light / sepia / forest / midnight)". |

Frontend-only: no server routes, no DB schema, no API changes.

---

### Task 1: Rewrite the theme test to the five-theme picker

**Files:**
- Modify: `src/server.test.ts` — replace the test at lines 822–838 (`"theme tokens, light mode, and theme toggle controls are present"`)
- Test: the replaced test itself

**Interfaces:**
- Consumes: the new markup/CSS/JS produced in Tasks 2–4.
- Produces: the failing assertion set that defines the contract (select id, five theme names in CSS, new app.js functions).

- [ ] **Step 1: Replace the theme test**

Replace the whole `test("theme tokens, light mode, and theme toggle controls are present", ...)` block (currently lines 822–838) with:

```ts
test("theme picker, five themes, and persistence are present", async () => {
  const htmlRes = await fetch(`${base}/index.html`);
  const html = await htmlRes.text();
  expect(html).toContain('id="theme-select"');
  expect(html).toContain("inkwell-theme");
  expect(html).toContain('<option value="dark">Dark</option>');
  expect(html).toContain('<option value="sepia">Sepia</option>');
  expect(html).toContain('<option value="midnight">Midnight</option>');

  const cssRes = await fetch(`${base}/style.css`);
  const css = await cssRes.text();
  expect(css).toContain("--themes: dark light sepia forest midnight");
  expect(css).toContain('[data-theme="light"]');
  expect(css).toContain('[data-theme="sepia"]');
  expect(css).toContain('[data-theme="forest"]');
  expect(css).toContain('[data-theme="midnight"]');

  const jsRes = await fetch(`${base}/app.js`);
  const js = await jsRes.text();
  expect(js).toContain("inkwell-theme");
  expect(js).toContain("availableThemes");
  expect(js).toContain("applyTheme");
  expect(js).toContain("populateThemeSelect");
  expect(js).toContain("setTheme");
  expect(js).toContain("theme-select");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — `id="theme-select"` not found (the old button is still there) and `--themes` still says `dark light`.

- [ ] **Step 3: Commit**

```bash
git add src/server.test.ts
git commit -m "test: redefine the theme contract around a five-theme picker"
```

---

### Task 2: Theme picker markup in index.html

**Files:**
- Modify: `src/public/index.html` — Appearance section of `#more-menu`
- Test: the Task 1 test (now partially passing)

**Interfaces:**
- Produces: `<select id="theme-select" class="font-select" aria-label="Theme">` whose `<option value="…">` values match the `--themes` names from Task 3 exactly: `dark, light, sepia, forest, midnight`.
- Consumes: nothing new (the pre-hydration `<script>` in `<head>` keeps reading `inkwell-theme` and setting `data-theme` — leave it alone).

- [ ] **Step 1: Replace the Theme button with the theme select**

In `src/public/index.html`, in the Appearance `<section class="menu-section">` of `#more-menu`, replace the current Theme row:

```html
    <div class="menu-row">
      <span class="menu-label">Theme</span>
      <button id="theme-toggle" class="btn" type="button" aria-label="Switch theme"></button>
    </div>
```

with:

```html
    <div class="menu-row">
      <span class="menu-label">Theme</span>
      <select id="theme-select" class="font-select" aria-label="Theme">
        <option value="dark">Dark</option>
        <option value="light">Light</option>
        <option value="sepia">Sepia</option>
        <option value="forest">Forest</option>
        <option value="midnight">Midnight</option>
      </select>
    </div>
```

The row sits between the Appearance heading and the Text size row, exactly where the button was. Reusing the `font-select` class means no new CSS rule is needed for the control itself.

- [ ] **Step 2: Run the test**

Run: `bun test`
Expected: the html assertions in the Task 1 test now pass; css/js assertions still fail.

- [ ] **Step 3: Commit**

```bash
git add src/public/index.html
git commit -m "feat: replace theme toggle button with a five-theme select"
```

---

### Task 3: New theme token blocks in style.css

**Files:**
- Modify: `src/public/style.css` — two spots: the `--themes` declaration in `:root` (line 28) and new blocks after the `[data-theme="light"]` block (ends line 56)
- Test: the Task 1 test (css assertions)

**Interfaces:**
- Produces: `--themes: dark light sepia forest midnight;` and `[data-theme="sepia"]`, `[data-theme="forest"]`, `[data-theme="midnight"]` token blocks overriding the same variables the light block overrides.
- Consumes: the existing token vocabulary (every var below is already used by components; do not invent new token names).

- [ ] **Step 1: Run the test to confirm it still fails on CSS**

Run: `bun test`
Expected: FAIL — `--themes` lacks the new names.

- [ ] **Step 2: Extend `--themes` and add the three blocks**

(a) In `:root`, change line 28 from:

```css
  --themes: dark light;
```

to:

```css
  --themes: dark light sepia forest midnight;
```

(b) Immediately after the closing brace of the `[data-theme="light"]` block (line 56), add:

```css
[data-theme="sepia"] {
  --bg: #f4ecd8;
  --bg-sidebar: #ece1c6;
  --border: #d6c6a3;
  --text: #3d3424;
  --text-dim: #5c5140;
  --text-faint: #7a6f5c;
  --accent: #9c5b2c;
  --danger: #a03a2e;
  --schedule: #8a6d1f;
  --surface-1: #fbf6e9;
  --surface-2: #efe5cc;
  --surface-3: #f0e6d0;
  --surface-inset: #e7dcc0;
  --text-strong: #241e12;
  --border-strong: #c4b18a;
  --editor-surface: #faf5e8;
  --overlay: rgba(70, 55, 25, 0.35);
  --shadow-modal: 0 12px 32px rgba(70, 55, 25, 0.25);
}

[data-theme="forest"] {
  --bg: #0f1a12;
  --bg-sidebar: #0a130c;
  --border: #27402f;
  --text: #c9d6c9;
  --text-dim: #9db0a0;
  --text-faint: #7f9482;
  --accent: #8fd6a4;
  --danger: #d97583;
  --schedule: #e3b341;
  --surface-1: #142318;
  --surface-2: #182a1d;
  --surface-3: #17261b;
  --surface-inset: #0d1810;
  --text-strong: #e6f0e6;
  --border-strong: #38543f;
  --editor-surface: #132117;
  --overlay: rgba(0, 0, 0, 0.6);
  --shadow-modal: 0 12px 32px rgba(0, 0, 0, 0.55);
}

[data-theme="midnight"] {
  --bg: #0b1020;
  --bg-sidebar: #070b18;
  --border: #26324f;
  --text: #c3cbe0;
  --text-dim: #98a2bd;
  --text-faint: #7c87a5;
  --accent: #8ab4ff;
  --danger: #e0828f;
  --schedule: #e6c15c;
  --surface-1: #101830;
  --surface-2: #141d38;
  --surface-3: #131b33;
  --surface-inset: #0a101f;
  --text-strong: #e2e8f8;
  --border-strong: #3a4768;
  --editor-surface: #0f162b;
  --overlay: rgba(0, 0, 0, 0.65);
  --shadow-modal: 0 12px 32px rgba(0, 0, 0, 0.6);
}
```

Every variable a component reads (`--bg`, `--bg-sidebar`, `--border`, `--text`, `--text-dim`, `--text-faint`, `--accent`, `--danger`, `--schedule`, `--surface-1..3`, `--surface-inset`, `--text-strong`, `--border-strong`, `--editor-surface`, `--overlay`, `--shadow-modal`) is overridden, mirroring the light block exactly. Do not touch `--serif`/`--sans`/`--mono`/`--editor-font`/`--editor-font-size`/`--editor-max-width` in the theme blocks.

- [ ] **Step 3: Run the test to verify it passes on CSS**

Run: `bun test`
Expected: css assertions in the Task 1 test pass; js assertions still fail.

- [ ] **Step 4: Commit**

```bash
git add src/public/style.css
git commit -m "feat: add sepia, forest, and midnight theme tokens"
```

---

### Task 4: Theme select logic in app.js

**Files:**
- Modify: `src/public/app.js` — the whole `// --- theme ---` section (lines 751–791)
- Test: the Task 1 test (js assertions)

**Interfaces:**
- Consumes: `#theme-select` (Task 2); `--themes` (Task 3).
- Produces: `populateThemeSelect(themes)` (fills `#theme-select` from `--themes`), `setTheme(name, themes)` (applies + persists + syncs the select). `availableThemes()` / `currentTheme()` / `applyTheme()` keep their current behavior and names — the Task 1 test and the pre-hydration contract depend on them.

- [ ] **Step 1: Run the test to confirm it fails on JS**

Run: `bun test`
Expected: FAIL — `populateThemeSelect` not found in app.js.

- [ ] **Step 2: Rewrite the theme section**

Replace the entire `// --- theme ---` section in `src/public/app.js` (from `const THEME_KEY = 'inkwell-theme';` at line 753 through the end of the `initTheme` IIFE at line 791) with:

```js
const THEME_KEY = 'inkwell-theme';
const themeSelect = el('theme-select');

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
  if (themeSelect) themeSelect.value = name;
}

function setTheme(name, themes) {
  if (themes.includes(name)) applyTheme(name, themes);
}

function populateThemeSelect(themes) {
  if (!themeSelect) return;
  themeSelect.replaceChildren();
  for (const name of themes) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    themeSelect.appendChild(opt);
  }
}

(function initTheme() {
  const themes = availableThemes();
  populateThemeSelect(themes);
  const stored = localStorage.getItem(THEME_KEY);
  const startTheme = stored && themes.includes(stored) ? stored : themes[0];
  applyTheme(startTheme, themes);
  themeSelect?.addEventListener('change', (e) => setTheme(e.target.value, themes));
})();
```

Behavior notes to preserve:
- `applyTheme` still removes `data-theme` for the FIRST theme in `--themes` (dark) and sets it otherwise — identical to today.
- `inkwell-theme` is still written on every apply, and `setTheme` rejects names not in the current `--themes` list (guards against stale localStorage values).
- The select is populated from `--themes` rather than hardcoding the five names, so it can never drift from the CSS.
- The old `themeBtn`/☀☾ icon logic is gone — the button no longer exists in the markup.

- [ ] **Step 3: Run the whole suite**

Run: `bun test`
Expected: exit 0, all tests pass (Task 1's test included).

- [ ] **Step 4: Syntax-check app.js**

Run: `node --check src/public/app.js`
Expected: exit 0. (Guards against duplicate top-level declarations — the regression class from `adws/specs/df0335e6_fix-duplicate-escapehtml.md`.)

- [ ] **Step 5: Commit**

```bash
git add src/public/app.js
git commit -m "feat: drive the theme picker from the themes list"
```

---

### Task 5: README + full verification

**Files:**
- Modify: `README.md` (line 40)
- Test: the full suite, manual smoke test

- [ ] **Step 1: Update the README**

In `README.md`, under **Quiet Room Layout**, change line 40 from:

```md
- **More menu** (`⋯` button): a popover holding the theme toggle (☀/☾), text size (`A−` / `A+`), the word goal, the view-mode switch, focus mode, keyboard shortcuts, publish/unpublish, and delete.
```

to:

```md
- **More menu** (`⋯` button): a popover holding the theme picker (dark / light / sepia / forest / midnight), text size (`A−` / `A+`), the word goal, the view-mode switch, focus mode, keyboard shortcuts, publish/unpublish, and delete.
```

- [ ] **Step 2: Run the whole test suite**

Run: `bun test`
Expected: exit 0, all tests pass.

- [ ] **Step 3: Manual smoke test**

Run: `bun run dev`, open `http://localhost:4501`, open the `⋯` menu, find the **Theme** select in the Appearance section.

1. The select shows **Dark** by default and the app renders exactly as before (dark tokens, no `data-theme` attribute on `<html>`).
2. Choose **Light** → renders the existing light palette; reload → Light is still selected and applied (`data-theme="light"`).
3. Choose **Sepia**, **Forest**, **Midnight** in turn → each renders its palette across sidebar, editor surface, preview, menus, modals, and buttons; the select reflects the choice.
4. Reload with a non-default theme selected → the page paints in that theme before `app.js` loads (the pre-hydration inline script still works).
5. Set a bogus value (`localStorage.setItem('inkwell-theme','hotdog')`) and reload → falls back to Dark, no console errors.
6. The `#font-select` and width controls still work alongside the theme select.

- [ ] **Step 4: Commit any leftover fixups** (only if a step above surfaced a bug)

```bash
git add -A
git commit -m "fix: theme picker follow-ups"
```

---

## Self-Review

- **Spec coverage:** request = "add themes". Task 2 adds the picker UI; Task 3 provides three new themes on top of the existing two; Task 4 wires it to the existing engine; Task 5 documents it. ✓
- **Placeholder scan:** every step contains concrete code or exact commands; no TBD/TODO. ✓
- **Type consistency:** option values in Task 2 (`dark, light, sepia, forest, midnight`) match the `--themes` list in Task 3 and the CSS block names; `theme-select` is spelled identically in Tasks 1, 2, and 4; `populateThemeSelect`/`setTheme` names match between the Task 1 test and the Task 4 implementation; `inkwell-theme` key is unchanged everywhere. ✓
- **Back-compat:** `--themes` order keeps `dark` first (default) and `light` second; `applyTheme`'s default-removes-attribute behavior is preserved, so the pre-hydration script and existing saved themes behave exactly as before. ✓
