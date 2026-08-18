# Zoom In/Out Should Also Affect the Title — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the font-size "zoom" controls (`⌘+`/`Ctrl+`, `⌘−`/`Ctrl−`, and the A+/A− buttons in the ⋯ menu) scale the editor title input along with the text area and preview, instead of only the text area.

**Architecture:** The zoom controls already write a single CSS variable, `--editor-font-size`, onto `document.documentElement` in `applyFontSize()` (`src/public/app.js`). `.content` and `.preview` consume that variable, but `.title` (the editor title `<input>`) has a hard-coded `font-size: 30px`, so it never moves when zooming. The fix is one CSS rule change: derive the title size from the same variable so it scales with zoom while keeping the current 30px look at the default 18px size (`18px + 12px = 30px`). No JavaScript, HTML, or README changes are needed — the shortcuts list ("Increase font size" / "Decrease font size") stays accurate.

**Tech Stack:** Bun (server + test runner, `bun test`), vanilla JS/CSS/HTML frontend served statically by `src/server.ts`.

**Spec:** Request is `adws/prompts/11-fix--zoom-in-out-should-also-affect-the-.md` ("fix: zoom in/out should also affect the title, not only the text area"). Recorded as `adws/specs/016f4efe_zoom-affects-title.md`.

## Global Constraints

- `--editor-font-size` is the single source of truth for editor zoom (defined in `:root` in `style.css`, overridden at runtime by `applyFontSize()`). Do not add a second variable or any JS-side title sizing.
- The `.title` size at the default font size (18px) must remain 30px — the current design — and scale through the whole range `FONT_SIZES = [16, 18, 20, 22, 24]`.
- Use only plain `calc()` with `+` (supported by every browser that supports `calc()`); do not rely on newer `calc()` multiplication/division.
- Do not modify `src/public/app.js`, `src/public/index.html`, or `README.md`.
- `bun test` must stay green — the suite contains content assertions on `style.css`, including a test that slices the standalone `.title {` rule block (`src/server.test.ts:398`).

---

### Task 1: Make the title font size derive from the editor zoom variable

**Files:**
- Modify: `src/public/style.css:527-534` (the standalone `.title { ... }` rule)
- Test: `src/server.test.ts` (append after the `"style.css separates the title from the text area with a background-colored gap"` test, ~line 407)

**Interfaces:**
- Consumes: the existing `--editor-font-size` CSS variable (default `18px`), set by `applyFontSize()` in `src/public/app.js` (unchanged).
- Produces: a `.title` rule whose `font-size` is `calc(var(--editor-font-size, 18px) + 12px)` — 28px at 16, 30px at 18 (default, current look), 32px at 20, 34px at 22, 36px at 24. Later work (if any) reads the title size from `--editor-font-size` exactly as `.content` and `.preview` do.

- [ ] **Step 1: Write the failing test**

Append to `src/server.test.ts`, right after the existing `"style.css separates the title from the text area with a background-colored gap"` test (which uses the same `.title {`-block slicing technique):

```ts
test("style.css scales the title font size with the editor font size", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();

  // slice just the standalone .title rule block (the shared
  // ".title, .content, .preview" rule is not matched by ".title {")
  const titleRule = css.slice(css.indexOf(".title {"), css.indexOf("}", css.indexOf(".title {")));
  expect(titleRule).toContain("var(--editor-font-size");
  expect(titleRule).not.toContain("font-size: 30px");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/server.test.ts -t "scales the title font size"`

Expected: FAIL — the current `.title` rule contains `font-size: 30px;` and no `var(--editor-font-size`, so `toContain("var(--editor-font-size")` fails.

- [ ] **Step 3: Write the minimal implementation**

In `src/public/style.css`, change the standalone `.title` rule (currently at lines 527-534) from:

```css
.title {
  padding-top: 64px;
  padding-bottom: 18px;
  font-size: 30px;
  font-weight: 500;
  line-height: 1.3;
  margin-bottom: 24px;
}
```

to:

```css
.title {
  padding-top: 64px;
  padding-bottom: 18px;
  font-size: calc(var(--editor-font-size, 18px) + 12px);
  font-weight: 500;
  line-height: 1.3;
  margin-bottom: 24px;
}
```

Do not touch the shared `.title, .content, .preview` rule (line 516) or anything else.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test`

Expected: PASS — all tests green, including the new title-scaling test and the existing `"style.css separates the title..."` test (its slice still finds the standalone `.title {` rule; the block keeps `margin-bottom: 24px` and gains no `border-bottom`).

- [ ] **Step 5: Commit**

```bash
git add src/public/style.css src/server.test.ts
git commit -m "fix: zoom in/out scales the title font size too"
```

---

## Verification

1. **Automated:** `bun test` — full suite green. (The repo's quality gates also run typecheck/build/snyk on commit; this change touches only CSS + a test, so those should pass unchanged.)
2. **Manual smoke (with `bun run dev`):**
   - Open the app in a browser, start a post with a title and some body text.
   - Press `⌘+` (or `Ctrl+`) repeatedly: the body text AND the title input both grow. At 18px the title renders at 30px, unchanged from before.
   - Press `⌘−` (or `Ctrl−`) repeatedly: both shrink; the title stays larger than the body at every step (title = body + 12px).
   - Repeat using the ⋯ menu → A+ / A− buttons and confirm the label (`18px`, `20px`, …) still updates and the choice persists across reload.
   - Switch to split/preview mode: the preview headings already scale with zoom (they are `em`-relative to `.preview`, which consumes `--editor-font-size`) — confirm they move in lockstep with the title and body.
