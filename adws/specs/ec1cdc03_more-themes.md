# Add more theme options (ocean, rose, graphite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing five-theme picker (dark, light, sepia, forest, midnight) with three new themes — **ocean** (light, cool aqua-blue), **rose** (light, warm rose), **graphite** (dark, neutral gray) — taking the picker to eight themes total. The default stays dark; every stored theme keeps working.

**Architecture:** No new mechanism. The theme engine is already fully data-driven: `:root { --themes: dark light sepia forest midnight; }` lists theme names, `[data-theme="…"]` blocks override the token palette, `app.js` reads `--themes` via `availableThemes()` and `populateThemeSelect()` rebuilds `#theme-select` from that list at boot. Because the select is populated from `--themes`, **`src/public/app.js` needs zero changes** — the three new themes flow through automatically. The work is: extend the `--themes` list, add three token blocks, add three `<option>` rows to the static markup, tighten the test contract, and update the README.

**Tech Stack:** Vanilla JS, CSS custom properties, localStorage (same as the existing theme / font-size / font-family / type-width settings). Zero new dependencies, no new files.

**Spec:** `adws/specs/ec1cdc03_more-themes.md` (this document, also at the session `context_handoff/plan.md`).

## Global Constraints

- **Zero new dependencies** — themes are CSS token blocks only (repo README: "zero dependencies"). No color libraries, no JSON theme files.
- **Keep the existing mechanism untouched**: `--themes` in `:root`, `[data-theme="…"]` blocks, `inkwell-theme` localStorage key, `availableThemes()` / `applyTheme()` / `populateThemeSelect()` / `setTheme()` in app.js. The default is the FIRST name in `--themes`; `applyTheme` removes `data-theme` for the default and sets it otherwise (the pre-hydration inline script in `index.html` sets `data-theme` from localStorage before CSS loads — leave it alone).
- **Do NOT modify `src/public/app.js`.** `populateThemeSelect` derives the option list from `--themes` at runtime, so new themes appear in the select with no JS change. The pre-hydration script applies any stored theme name generically, so saved `inkwell-theme=ocean` etc. will paint before JS loads. Touching app.js risks the duplicate-declaration regression class from `adws/specs/df0335e6_fix-duplicate-escapehtml.md`.
- **Order of `--themes` is `dark light sepia forest midnight ocean rose graphite`** — `dark` stays first (default) and `light` stays second (back-compat for stored `inkwell-theme=light`); the three new names are appended at the end. Keep the SAME order in all three lists: `--themes` (CSS), the `<option>` rows (HTML), and the README parenthetical.
- **Replace, don't duplicate**: no new CSS rules beyond the three token blocks; the `.font-select` class already styles the select. The three new blocks override exactly the same 18 tokens the existing light/sepia/forest/midnight blocks override — do not invent new token names.
- All tests live in `src/server.test.ts` as served-content presence assertions (repo convention). Judge commands by exit status, never by scanning output text. `bun test` must exit 0.

## File Structure

| File | Change |
| --- | --- |
| `src/public/style.css` | Line 28: `--themes: dark light sepia forest midnight ocean rose graphite;` plus three new token blocks `[data-theme="ocean"]`, `[data-theme="rose"]`, `[data-theme="graphite"]` inserted immediately after the closing brace of the `[data-theme="midnight"]` block (before the `*, *::before, *::after` rule). |
| `src/public/index.html` | Add three `<option>` rows (`ocean`, `rose`, `graphite`) to `#theme-select`, after the existing `<option value="midnight">Midnight</option>` (currently line 78). The pre-hydration script in `<head>` stays untouched. |
| `src/server.test.ts` | Update the theme test (currently lines 822–847): title "five themes" → "eight themes"; `--themes` assertion → the 8-name list; add html option assertions and css block assertions for the three new names. JS assertions unchanged. |
| `README.md` | Line 40: extend the theme picker parenthetical to `(dark / light / sepia / forest / midnight / ocean / rose / graphite)`. |

Frontend-only: no server routes, no DB schema, no API changes. No changes to `src/public/app.js`.

---

### Task 1: Tighten the theme test to the eight-theme contract

**Files:**
- Modify: `src/server.test.ts` — the test at lines 822–847 (`"theme picker, five themes, and persistence are present"`)
- Test: the replaced test itself

**Interfaces:**
- Consumes: the new markup/CSS produced in Tasks 2–3.
- Produces: the failing assertion set that defines the contract (three new option names in HTML, the 8-name `--themes` list, three new `[data-theme]` blocks in CSS).

- [ ] **Step 1: Replace the theme test**

Replace the whole `test("theme picker, five themes, and persistence are present", ...)` block (lines 822–847) with:

```ts
test("theme picker, eight themes, and persistence are present", async () => {
  const htmlRes = await fetch(`${base}/index.html`);
  const html = await htmlRes.text();
  expect(html).toContain('id="theme-select"');
  expect(html).toContain("inkwell-theme");
  expect(html).toContain('<option value="dark">Dark</option>');
  expect(html).toContain('<option value="sepia">Sepia</option>');
  expect(html).toContain('<option value="midnight">Midnight</option>');
  expect(html).toContain('<option value="ocean">Ocean</option>');
  expect(html).toContain('<option value="rose">Rose</option>');
  expect(html).toContain('<option value="graphite">Graphite</option>');

  const cssRes = await fetch(`${base}/style.css`);
  const css = await cssRes.text();
  expect(css).toContain("--themes: dark light sepia forest midnight ocean rose graphite");
  expect(css).toContain('[data-theme="light"]');
  expect(css).toContain('[data-theme="sepia"]');
  expect(css).toContain('[data-theme="forest"]');
  expect(css).toContain('[data-theme="midnight"]');
  expect(css).toContain('[data-theme="ocean"]');
  expect(css).toContain('[data-theme="rose"]');
  expect(css).toContain('[data-theme="graphite"]');

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
Expected: FAIL — `--themes` still says `dark light sepia forest midnight` and the new `<option>` / `[data-theme]` strings are absent. (JS assertions still pass — app.js is intentionally untouched.)

- [ ] **Step 3: Commit**

```bash
git add src/server.test.ts
git commit -m "test: extend the theme contract to eight themes"
```

---

### Task 2: New theme token blocks in style.css

**Files:**
- Modify: `src/public/style.css` — two spots: the `--themes` declaration in `:root` (line 28) and new blocks immediately after the closing brace of the `[data-theme="midnight"]` block
- Test: the Task 1 test (css assertions)

**Interfaces:**
- Produces: `--themes: dark light sepia forest midnight ocean rose graphite;` and `[data-theme="ocean"]`, `[data-theme="rose"]`, `[data-theme="graphite"]` token blocks overriding exactly the same variables the light block overrides (18 tokens, listed below).
- Consumes: the existing token vocabulary — do not invent new token names. Do not touch `--serif`/`--sans`/`--mono`/`--editor-font`/`--editor-font-size`/`--editor-max-width` in the theme blocks.

- [ ] **Step 1: Run the test to confirm it still fails on CSS**

Run: `bun test`
Expected: FAIL — `--themes` lacks the new names and the new blocks don't exist.

- [ ] **Step 2: Extend `--themes` and add the three blocks**

(a) In `:root`, change line 28 from:

```css
  --themes: dark light sepia forest midnight;
```

to:

```css
  --themes: dark light sepia forest midnight ocean rose graphite;
```

(b) Immediately after the closing brace of the `[data-theme="midnight"]` block (the block ends with `--shadow-modal: 0 12px 32px rgba(0, 0, 0, 0.6);` followed by `}` — it sits right before `*, *::before, *::after { box-sizing: border-box; }`), add:

```css
[data-theme="ocean"] {
  --bg: #eef4f8;
  --bg-sidebar: #e5edf4;
  --border: #c8d8e4;
  --text: #22313f;
  --text-dim: #47596b;
  --text-faint: #5f7185;
  --accent: #0e6f9c;
  --danger: #b3353f;
  --schedule: #8a5a00;
  --surface-1: #f8fbfd;
  --surface-2: #dce8f1;
  --surface-3: #e1ebf3;
  --surface-inset: #d7e4ee;
  --text-strong: #15222e;
  --border-strong: #b5c9d8;
  --editor-surface: #f5fafd;
  --overlay: rgba(30, 50, 65, 0.35);
  --shadow-modal: 0 12px 32px rgba(30, 50, 65, 0.25);
}

[data-theme="rose"] {
  --bg: #faf1f2;
  --bg-sidebar: #f4e7e9;
  --border: #e0c9cd;
  --text: #3a2a2e;
  --text-dim: #5d4a4f;
  --text-faint: #76646a;
  --accent: #a8455c;
  --danger: #a03a2e;
  --schedule: #8a5a00;
  --surface-1: #fffafb;
  --surface-2: #f0dfe2;
  --surface-3: #f3e4e7;
  --surface-inset: #ecd9dd;
  --text-strong: #291b1f;
  --border-strong: #d3b6bc;
  --editor-surface: #fdf7f8;
  --overlay: rgba(70, 40, 45, 0.35);
  --shadow-modal: 0 12px 32px rgba(70, 40, 45, 0.25);
}

[data-theme="graphite"] {
  --bg: #16181d;
  --bg-sidebar: #101217;
  --border: #2e323b;
  --text: #c8ccd4;
  --text-dim: #9ba1ad;
  --text-faint: #828895;
  --accent: #7fc4b4;
  --danger: #d97583;
  --schedule: #e3b341;
  --surface-1: #1c1f26;
  --surface-2: #20242c;
  --surface-3: #1f2229;
  --surface-inset: #14171d;
  --text-strong: #e4e7ee;
  --border-strong: #3d434f;
  --editor-surface: #1b1e25;
  --overlay: rgba(0, 0, 0, 0.6);
  --shadow-modal: 0 12px 32px rgba(0, 0, 0, 0.55);
}
```

Every variable a component reads (`--bg`, `--bg-sidebar`, `--border`, `--text`, `--text-dim`, `--text-faint`, `--accent`, `--danger`, `--schedule`, `--surface-1..3`, `--surface-inset`, `--text-strong`, `--border-strong`, `--editor-surface`, `--overlay`, `--shadow-modal`) is overridden in all three blocks, mirroring the existing blocks exactly — 18 tokens each, no more, no less.

- [ ] **Step 3: Run the test to verify it passes on CSS**

Run: `bun test`
Expected: css assertions in the Task 1 test pass; html assertions still fail.

- [ ] **Step 4: Commit**

```bash
git add src/public/style.css
git commit -m "feat: add ocean, rose, and graphite theme tokens"
```

---

### Task 3: New theme options in the picker markup

**Files:**
- Modify: `src/public/index.html` — `#theme-select` in the Appearance section of `#more-menu`
- Test: the Task 1 test (html assertions)

**Interfaces:**
- Produces: three new `<option>` rows whose `value` attributes match the `--themes` names from Task 2 exactly: `ocean`, `rose`, `graphite`.
- Consumes: nothing new (the pre-hydration `<script>` in `<head>` keeps reading `inkwell-theme` and setting `data-theme` — leave it alone).

- [ ] **Step 1: Run the test to confirm it still fails on HTML**

Run: `bun test`
Expected: FAIL — `value="ocean"` etc. not found in the served HTML.

- [ ] **Step 2: Add the three options**

In `src/public/index.html`, inside `<select id="theme-select" class="font-select" aria-label="Theme">`, immediately after:

```html
        <option value="midnight">Midnight</option>
```

add:

```html
        <option value="ocean">Ocean</option>
        <option value="rose">Rose</option>
        <option value="graphite">Graphite</option>
```

The select keeps its 5 existing options and now has 8, in the same order as `--themes`. (At runtime `populateThemeSelect` in app.js rebuilds the same list from `--themes`; these static options cover the no-JS state and the test contract.)

- [ ] **Step 3: Run the whole suite**

Run: `bun test`
Expected: exit 0, all tests pass (Task 1's test included).

- [ ] **Step 4: Commit**

```bash
git add src/public/index.html
git commit -m "feat: list ocean, rose, and graphite in the theme picker"
```

---

### Task 4: README + full verification

**Files:**
- Modify: `README.md` (line 40)
- Test: the full suite, manual smoke test

- [ ] **Step 1: Update the README**

In `README.md`, under **Quiet Room Layout**, change line 40 from:

```md
- **More menu** (`⋯` button): a popover holding the theme picker (dark / light / sepia / forest / midnight), text size (`A−` / `A+`), the word goal, the view-mode switch, focus mode, keyboard shortcuts, publish/unpublish, and delete.
```

to:

```md
- **More menu** (`⋯` button): a popover holding the theme picker (dark / light / sepia / forest / midnight / ocean / rose / graphite), text size (`A−` / `A+`), the word goal, the view-mode switch, focus mode, keyboard shortcuts, publish/unpublish, and delete.
```

- [ ] **Step 2: Run the whole test suite**

Run: `bun test`
Expected: exit 0, all tests pass.

- [ ] **Step 3: Manual smoke test**

Run: `bun run dev`, open `http://localhost:4501`, open the `⋯` menu, find the **Theme** select in the Appearance section.

1. The select shows **Dark** by default and the app renders exactly as before (dark tokens, no `data-theme` attribute on `<html>`).
2. The select lists all eight themes: Dark, Light, Sepia, Forest, Midnight, Ocean, Rose, Graphite — in that order.
3. Choose **Ocean** → renders the cool aqua palette across sidebar, editor surface, preview, menus, modals, and buttons; reload → Ocean is still selected and applied (`data-theme="ocean"`).
4. Choose **Rose** and **Graphite** in turn → each renders its palette across the same surfaces; the select reflects the choice.
5. The five pre-existing themes still work: Light, Sepia, Forest, Midnight all render their palettes.
6. Reload with a non-default theme selected → the page paints in that theme before `app.js` loads (the pre-hydration inline script still works).
7. Set a bogus value (`localStorage.setItem('inkwell-theme','hotdog')`) and reload → falls back to Dark, no console errors.
8. The `#font-select`, text-size, and width controls still work alongside the theme select.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the eight-theme picker"
```

- [ ] **Step 5: Commit any leftover fixups** (only if a step above surfaced a bug)

```bash
git add -A
git commit -m "fix: theme picker follow-ups"
```

---

## Self-Review

- **Spec coverage:** request = "add more theme options". Task 1 redefines the contract at eight themes; Task 2 adds three token blocks on top of the existing five; Task 3 lists them in the picker; Task 4 documents them. ✓
- **Placeholder scan:** every step contains concrete code or exact commands; no TBD/TODO. ✓
- **Type consistency:** option values in Task 3 (`ocean, rose, graphite`) match the `--themes` list and CSS block names in Task 2; the `--themes` string asserted in Task 1 matches exactly the line produced in Task 2 (`dark light sepia forest midnight ocean rose graphite`); README order matches. ✓
- **Back-compat:** `--themes` order keeps `dark` first (default) and `light` second; `applyTheme`'s default-removes-attribute behavior is untouched, so the pre-hydration script and all five existing saved themes behave exactly as before. ✓
- **No-JS-change guarantee:** app.js is data-driven from `--themes` (`populateThemeSelect`), so no JS edit is needed or planned; the Task 1 test's JS assertions pass unmodified throughout. ✓
