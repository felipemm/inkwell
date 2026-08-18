# Title scales with zoom (font size) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the zoom in/out controls (A− / A+ buttons and ⌘+ / ⌘− shortcuts) resize the title input too, not just the text area.

**Architecture:** All zoom controls funnel through `setFontSize()` → `applyFontSize()` in `src/public/app.js`, which sets `--editor-font-size` on `document.documentElement`; `.content` and `.preview` read that variable, but `.title` has a hard-coded `font-size: 30px`. Add a pure helper `titleFontSizeFor(editorSize)` (title = round(editorSize × 30/18), so the default 18px → 30px, unchanged), have `applyFontSize()` also set `--title-font-size`, and switch `.title` to `font-size: var(--title-font-size, 30px)`. This mirrors how `--editor-max-width` is already JS-driven and keeps the pre-JS fallback in the stylesheet.

**Tech Stack:** Vanilla JS frontend served by a Bun server (default port 4501). Tests are end-to-end `bun test` runs in `src/server.test.ts` that fetch the served assets (`/app.js`, `/style.css`) and assert on their content, plus behavioral tests on pure functions extracted with the existing `loadSection` helper.

**Spec:** `adws/prompts/11-fix--zoom-in-out-should-also-affect-the-.md` (the ticket: "zoom in/out should also affect the title, not only the text area")

## Global Constraints

- "Zoom in/out" means the app's font-size controls: the A− / A+ buttons (`#font-decrease` / `#font-increase`) in the `⋯` menu and the `⌘+` / `⌘−` (Ctrl+ / Ctrl−) shortcuts. All of them call `setFontSize(fontSize ± 2)`. There is no browser-page zoom code anywhere (`grep -ri zoom src` returns nothing).
- Default appearance must not change: at the default editor size 18px the title stays 30px (the current value). Only sizes 16/20/22/24 change (title becomes 27/33/37/40px).
- Judge every command by its exit status, never by scanning output for words.
- Call binaries by bare name (`bun`, `node`); never a hard-coded absolute path.
- Do not touch `adws/specs/*` or `adws/prompts/*` — historical records stay as they are.
- Follow the repo's existing test conventions (fetch served assets, `loadSection` on `// --- ... (pure) ---` sections, source assertions on the served text).

---

## Task 1: Pure `titleFontSizeFor` mapping + behavioral test

**Files:**
- Modify: `src/public/app.js` (new pure section just above `// --- quiet room: font size, reading time, goal ---`, currently line 383)
- Test: `src/server.test.ts` (new test right after `app.js contains reading time calculation and writing goal logic`, currently line 469)

**Interfaces:**
- Produces: `titleFontSizeFor(editorSize: number): number` — the title font size in px for a given editor font size. `Math.round(editorSize * (30 / 18))`. Later tasks rely on exactly this name and formula.

- [ ] **Step 1: Write the failing behavioral test**

Add this test to `src/server.test.ts`, immediately after the test `app.js contains reading time calculation and writing goal logic` (ends around line 481):

```ts
test("titleFontSizeFor keeps the title proportional to the editor font size (pure section)", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();

  const { titleFontSizeFor } = loadSection<any>(js, "quiet room: title scale (pure)", ["titleFontSizeFor"]);

  // the title is 30px at the default 18px editor size, so the ratio is 30/18 = 5/3
  expect(titleFontSizeFor(18)).toBe(30); // default — unchanged from today
  expect(titleFontSizeFor(16)).toBe(27);
  expect(titleFontSizeFor(20)).toBe(33);
  expect(titleFontSizeFor(22)).toBe(37);
  expect(titleFontSizeFor(24)).toBe(40);
  // monotonic: zooming in never shrinks the title
  expect(titleFontSizeFor(24)).toBeGreaterThan(titleFontSizeFor(16));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test 2>&1 | tail -5`
Expected: FAIL — `section "quiet room: title scale (pure)" not found in app.js` (the `loadSection` helper throws). Exit status non-zero.

- [ ] **Step 3: Add the pure section to `src/public/app.js`**

Insert this block directly above the existing section header `// --- quiet room: font size, reading time, goal ---------------------------` (currently line 383). The section must contain only this function — no DOM, no `localStorage`, no IIFE — so `loadSection` can evaluate it in isolation:

```js
// --- quiet room: title scale (pure) --------------------------------------

/** Title input font size that pairs with an editor font size (30px at the default 18px). */
function titleFontSizeFor(editorSize) {
  return Math.round(editorSize * (30 / 18));
}
```

Note: `(30 / 18)` is the exact ratio that makes 18 → 30. Keep it as a ratio, not a magic decimal — and do not use `editorSize + 12` (that yields 28/32/34/36 and breaks the proportional hierarchy).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test 2>&1 | tail -5`
Expected: PASS — the new `titleFontSizeFor ... (pure section)` test is green. Exit status 0.

- [ ] **Step 5: Syntax guard + commit**

Run: `node --check src/public/app.js`
Expected: exit status 0 (no output needed).

```bash
git add src/public/app.js src/server.test.ts
git commit -m "feat: add titleFontSizeFor zoom mapping for the title"
```

---

## Task 2: Wire `--title-font-size` into `applyFontSize` and `.title`

**Files:**
- Modify: `src/public/app.js` — `applyFontSize()` (currently lines 389-393)
- Modify: `src/public/style.css` — the standalone `.title` rule (currently lines 527-533; `font-size: 30px;` is line 530)
- Test: `src/server.test.ts` — extend the existing `.title`-rule CSS test (line 397) and add one `applyFontSize` source test near the Task 1 test

**Interfaces:**
- Consumes: `titleFontSizeFor(editorSize)` from Task 1.
- Produces: CSS custom property `--title-font-size` set inline on `document.documentElement` by `applyFontSize()`, consumed by `.title { font-size: var(--title-font-size, 30px); }`.

- [ ] **Step 1: Write the failing tests (source assertions)**

Add this test to `src/server.test.ts`, right after the Task 1 test:

```ts
test("app.js applyFontSize sets --title-font-size alongside --editor-font-size", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();

  // setFontSize immediately follows applyFontSize, so the slice is exactly the applyFontSize body
  const fn = js.slice(js.indexOf("function applyFontSize"), js.indexOf("function setFontSize"));
  expect(fn).toContain("--editor-font-size");
  expect(fn).toContain("--title-font-size");
  expect(fn).toContain("titleFontSizeFor(fontSize)");
});
```

Then extend the existing test `style.css separates the title from the text area with a background-colored gap` (line 397). Inside it, after the existing `expect(titleRule).toContain("margin-bottom: 24px");` line, add:

```ts
  expect(titleRule).toContain("var(--title-font-size, 30px)");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test 2>&1 | tail -5`
Expected: FAIL — the new `applyFontSize` test (no `--title-font-size` in app.js yet) and the extended CSS test (`var(--title-font-size, 30px)` not in `.title` yet). Exit status non-zero.

- [ ] **Step 3: Update `applyFontSize` in `src/public/app.js`**

Replace the current body (lines 389-393):

```js
function applyFontSize() {
  document.documentElement.style.setProperty('--editor-font-size', `${fontSize}px`);
  if (ui.fontSizeLabel) ui.fontSizeLabel.textContent = `${fontSize}px`;
  localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
}
```

with:

```js
function applyFontSize() {
  document.documentElement.style.setProperty('--editor-font-size', `${fontSize}px`);
  document.documentElement.style.setProperty('--title-font-size', `${titleFontSizeFor(fontSize)}px`);
  if (ui.fontSizeLabel) ui.fontSizeLabel.textContent = `${fontSize}px`;
  localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
}
```

`initFontSize()` (line ~414) already calls `applyFontSize()` on boot, so the title size applies on load and after every zoom change. No other JS changes.

- [ ] **Step 4: Update the `.title` rule in `src/public/style.css`**

In the standalone `.title` rule (line 527), change line 530:

```css
/* before */
  font-size: 30px;
/* after */
  font-size: var(--title-font-size, 30px);
```

Keep everything else in the rule (`padding-top: 64px; padding-bottom: 18px; font-weight: 500; line-height: 1.3; margin-bottom: 24px;`) untouched. The `30px` fallback keeps the pre-JS appearance identical and preserves the existing test assertions on this rule. Do **not** add `--title-font-size` to `:root` — the inline `var(...)` fallback covers the no-JS case and the default 18px maps to exactly 30px, so there is no flash.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test 2>&1 | tail -5`
Expected: PASS — all 88 tests green (86 baseline + 2 new). Exit status 0.

- [ ] **Step 6: Full quality gates + syntax guard**

Run each and check exit status is 0:

```bash
bun test
bun x tsc --noEmit
bun build src/server.ts --outdir /tmp/inkwell-build --target bun
node --check src/public/app.js
```

- [ ] **Step 7: Manual smoke (visual confirmation)**

Run: `bun run dev`, open `http://localhost:4501` in a browser, open a post:
- Default (fresh profile): title is 30px, text is 18px — identical to before this change.
- Press `⌘+` / `Ctrl+` twice and `⌘−` / `Ctrl−` twice; also click `⋯` → Text size → A+ / A−. The text area **and** the title input both grow/shrink together (title: 27/30/33/37/40px; text: 16/18/20/22/24px). The `font-size-label` readout tracks the editor size.
- Reload — the last size persists (`inkwell-font-size` key unchanged) and the title matches the editor size on load.

- [ ] **Step 8: Commit**

```bash
git add src/public/app.js src/public/style.css src/server.test.ts
git commit -m "feat: zoom in/out now scales the title with the text area"
```

---

## Do NOT touch (unrelated)

- `src/public/style.css:551` — `.preview` uses `var(--editor-font-size, 18px)`; headings inside the preview already scale via `em`, so no preview change is needed.
- `src/public/style.css:24` — the `:root` `--editor-font-size: 18px` default (still correct).
- `src/public/index.html` — no markup change; the title element, buttons, and shortcuts modal text ("Increase font size" / "Decrease font size") stay as-is.
- `adws/specs/*`, `adws/prompts/*` — historical records; do not rewrite.
- `src/server.ts` — the zoom/title change is purely client-side.

## Self-review notes

- Spec coverage: the ticket asks that zoom in/out affect the title as well as the text area. Task 1 provides the proportional mapping; Task 2 wires it through the single existing zoom code path (`applyFontSize`) and the `.title` rule, with a fallback preserving the default look. No other zoom paths exist.
- Type consistency: `titleFontSizeFor` is defined in Task 1 and consumed by name in Task 2; both use the same signature and the `--title-font-size` property name is consistent across `app.js` and `style.css`.
- Placeholder scan: every step has concrete code; no TBDs.
