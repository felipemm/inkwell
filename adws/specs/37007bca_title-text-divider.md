# Add a small divider between the title and the text area

## Request

> add a small divider between title and text area

In the editor, visually separate the title field from the writing area below it with a thin divider line.

## Current state

- `src/public/index.html`: the editor is `<main class="editor" id="editor" hidden>` containing `<input id="title" class="title" …>` immediately followed by `<div id="panes" class="panes">` which holds the `<textarea id="content" class="content" …>` (and the preview pane). There is no element or rule between the title and the panes today.
- `src/public/style.css`: the shared rule `.title, .content, .preview { … border: 0; … }` gives the title no border. The standalone `.title { … }` block sets only `padding-top`, `padding-bottom`, `font-size`, `font-weight`, `line-height`. There is no separator between title and content.
- Existing divider conventions in the same file: the footer, sidebar-footer, and split-mode preview pane all use `1px solid var(--border)` (`border-top` / `border-left`). Reuse that token for consistency.
- Tests: `src/server.test.ts` covers frontend changes with presence assertions that fetch `style.css` and check substrings (e.g. `"style.css defines all three layouts"` slices a rule block and asserts on it). Follow that pattern.

## Changes

### 1. `src/public/style.css` — draw the divider on the title

In the `/* --- editor --- */` section, the standalone `.title` rule currently reads:

```css
.title {
  padding-top: 64px;
  padding-bottom: 18px;
  font-size: 30px;
  font-weight: 500;
  line-height: 1.3;
}
```

Change it to:

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

- The `.title` rule appears after the shared `.title, .content, .preview { … border: 0; … }` rule and has equal specificity, so `border-bottom` overrides only the bottom edge — the title gets a thin 1px divider in the theme's `--border` color, matching the footer/sidebar/split-pane dividers.
- The border spans the title's box, which is `width: 100%; max-width: var(--editor-max-width)` with `box-sizing: border-box` — i.e. exactly the width of the text area column below it, so the divider aligns with the writing area.
- In split view `body[data-view-mode="split"] .title` only overrides `max-width`/`padding`, so the divider stays and spans the full editor width, consistent with the border-left between the two panes. In preview mode the divider still separates title from preview — acceptable and consistent.
- No HTML change needed; `#title` and `#panes` already exist. No `app.js` change; this is purely presentational.

### 2. `src/server.test.ts` — presence assertion (follow existing conventions)

Add a test near the other `style.css contains …` tests (e.g. right after `"style.css contains focus-mode styles"`, ~line 390):

```ts
test("style.css draws a divider between the title and the text area", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();

  // slice just the standalone .title rule block (the shared
  // ".title, .content, .preview" rule is not matched by ".title {")
  const titleRule = css.slice(css.indexOf(".title {"), css.indexOf("}", css.indexOf(".title {")));
  expect(titleRule).toContain("border-bottom: 1px solid var(--border)");
});
```

- Slicing the `.title { … }` block keeps the assertion specific: `border-bottom: 1px solid var(--border)` already appears in other rules, so a bare `toContain` on the whole file would pass even if the title never changed. The slice forces the divider to live on the title.
- Token discipline: use `var(--border)`, no hex/rgba literals (consistent with the file's conventions and the view-modes test).

## Out of scope

- No `index.html` or `app.js` changes.
- No server/API changes.
- No new element or wrapper div — a border on the existing `.title` is the smallest change that produces the divider.

## Verification (judge by exit status, not output text)

1. `bun test` — full suite passes, including the new `"style.css draws a divider between the title and the text area"` test.
2. Manual smoke — `bun run dev`, open `http://localhost:4501`:
   - Open a post (or `+ new`): a thin 1px divider line separates the title input from the markdown text area, aligned with the writing column.
   - Switch to split view (`⌘Enter` / `CtrlEnter` twice): the divider spans the full editor width and sits above the two panes.
   - Switch themes (more menu → Theme): the divider color follows the theme (`--border`).
