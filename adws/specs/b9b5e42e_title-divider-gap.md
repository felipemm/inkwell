# Replace the title divider line with a background-colored gap

## Request

> the title divider should be a small gap with the same background color, different from the text area background

The divider between the title field and the writing area is currently a 1px `--border` line (added by spec `37007bca`). Replace it with a small vertical gap whose background is the page background (`--bg`), which is visibly different from the text area background (`--editor-surface`). The gap reads as whitespace separation instead of a drawn line.

## Current state

- `src/public/style.css`, `/* --- editor --- */` section — the standalone rule reads:

```css
.title {
  padding-top: 64px;
  padding-bottom: 18px;
  font-size: 30px;
  font-weight: 500;
  line-height: 1.3;
  border-bottom: 1px solid var(--border);
}
```

- Layout facts that make the gap work with zero HTML changes:
  - `body { background: var(--bg); }` and `.editor` sets **no** background (transparent), so any space between `.title` and `#panes` shows `--bg` — the page color, same as the surroundings and different from the text area's `--editor-surface`.
  - `.title` sits in the shared rule `.title, .content, .preview { … margin: 0 auto; … background: var(--editor-surface); … }`. Because the shared rule sets `margin: 0 auto` (horizontal centering), adding `margin-bottom` on the later standalone `.title` rule only overrides the bottom margin — the horizontal centering is untouched.
  - `body[data-view-mode="split"] .title` only overrides `max-width`/`padding`, so the margin-bottom gap persists in split and preview modes, spanning the full editor width.
- Tests: `src/server.test.ts` has `"style.css draws a divider between the title and the text area"` (~line 398) which slices the standalone `.title { … }` block and asserts `border-bottom: 1px solid var(--border)`. That assertion must be replaced — it will fail once the border is removed.

## Changes

### 1. `src/public/style.css` — swap the border for a gap

In the standalone `.title` rule, remove the border line and add a bottom margin:

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

- `margin-bottom: 24px` creates the small gap. The gap's background is `--bg` (page background) because `.editor` is transparent — the exact intent: "same background color, different from the text area background."
- Do **not** use `padding-bottom` for the gap: padding is inside the element's box and would keep the `--editor-surface` background, making the gap invisible.
- `padding-bottom: 18px` stays — it is the breathing room *inside* the title's surface; the 24px margin is the divider itself.
- No `index.html` change (no new element/wrapper needed) and no `app.js` change.

### 2. `src/server.test.ts` — update the divider test to assert the gap

Replace the body of `"style.css draws a divider between the title and the text area"` (~line 398) with:

```ts
test("style.css separates the title from the text area with a background-colored gap", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();

  // slice just the standalone .title rule block (the shared
  // ".title, .content, .preview" rule is not matched by ".title {")
  const titleRule = css.slice(css.indexOf(".title {"), css.indexOf("}", css.indexOf(".title {")));
  expect(titleRule).not.toContain("border-bottom");
  expect(titleRule).toContain("margin-bottom: 24px");
});
```

- The slice targets the standalone `.title { … }` (first `.title {` occurrence in the file, which is the standalone rule — `body[data-view-mode="split"] .title {` appears later), keeping the assertion specific to the title rule, matching the file's existing slice-test convention.
- Asserting `not.toContain("border-bottom")` on the slice is what actually enforces "no line" — a bare file-wide check would pass on the many other `border-bottom` rules in the file.
- Keep the test name aligned with the new behavior (rename it as shown; update the test name anywhere it is referenced — it is referenced only in this block).

## Out of scope

- No `index.html` or `app.js` changes.
- No server/API changes.
- No new element or wrapper div.
- Other dividers in the file (footer, sidebar-footer, split-pane `border-left`) keep their `--border` lines — this change is only the title↔text-area divider.

## Verification (judge by exit status, not output text)

1. `bun test` — full suite passes, including the updated `"style.css separates the title from the text area with a background-colored gap"` test.
2. Manual smoke — `bun run dev`, open `http://localhost:4501`:
   - Open a post (or `+ new`): no line under the title; instead a small gap of page background separates the title input from the text area, clearly distinct from the editor surface behind both fields.
   - Switch to split view (`⌘Enter` / `CtrlEnter` twice): the gap spans the full editor width above the two panes.
   - Switch themes (more menu → Theme): the gap color follows `--bg` per theme (e.g. dark `#0d1117` vs. light `#f6f4ef`) and always differs from that theme's `--editor-surface`.
