# Wider type options, no scrollbars, visible editing surface, focus-mode chrome

## Request

> make the width size options larger, being the largest one able to occupy most the real state. Also ditch the scroll bar, it is visually ugly and distracting. Make the editable area background a subtle different from the rest so we can see the area it covers. Focus mode should hide the footer, but still show the hamburger and three dots header menus

## Current state (all in `src/public/`)

- **Width control** (shipped by `adws/specs/b2e79f76_type-width-options.md`): Appearance → Width in the `⋯` menu, 3 buttons `narrow`/`medium`/`wide`. `app.js` maps `TYPE_WIDTHS = { narrow: 560, medium: 720, wide: 960 }` and writes `--editor-max-width` on `document.documentElement`; `.title, .content, .preview` use `max-width: var(--editor-max-width)`. Default = `medium`, persisted under `inkwell-type-width`.
- **Scrollbars**: `style.css` styles a 9px webkit scrollbar (`::-webkit-scrollbar` block at the bottom) shown on every scrollable surface — the editor textarea (`#content`), `.preview`, `.post-list`, history list/diff.
- **Editable area**: `.title, .content, .preview` sit on `background: transparent` — the writing column floats on the page background with no visible boundary.
- **Focus mode** (`body.focus-mode`, toggled by ⌘⇧F / `#focus-toggle`): `.sidebar { display:none }`, `.footer { opacity:0.3; hover→1 }`, `.topbar { opacity:0; pointer-events:none }` — so today it hides the footer readouts AND the header menus (☰ and ⋯).

## Changes

### 1. `src/public/app.js` — bigger width options (largest ≈ full width)

In the `// --- quiet room: type width ---` section:

```js
const TYPE_WIDTHS = { narrow: 640, medium: 860, wide: 'calc(100% - 96px)' };
```

- `narrow` 560 → **640px**, `medium` 720 → **860px** (medium stays the default; existing users with `inkwell-type-width` saved keep their key, they just get the bigger value).
- `wide` becomes a **fluid** value: `calc(100% - 96px)` → the centered column spans nearly the full viewport with ~48px gutters each side, on any screen size. This is the "occupy most the real state" requirement.
- **Must** update `applyTypeWidth()` — appending `px` blindly would emit `calc(100% - 96px)px` (invalid). Replace the single setProperty line:

```js
function applyTypeWidth() {
  const v = TYPE_WIDTHS[typeWidth];
  document.documentElement.style.setProperty('--editor-max-width', typeof v === 'number' ? `${v}px` : v);
  // …rest unchanged (active button + aria-pressed + localStorage)…
}
```

- `setTypeWidth()`'s truthiness guard (`if (TYPE_WIDTHS[w])`) still works with the string value.
- No HTML change: the three `.width-btn` buttons and their `data-width` attributes stay as-is.
- Split mode is unaffected (its `.content`/`.preview` rules force `max-width: none`).

### 2. `src/public/style.css` — editable surface, no scrollbars, focus mode

**a) Editable-area background** — make the writing column visibly distinct, subtly:

- In `:root` (next to the other surface vars): `--editor-surface: #141b26;`
- In `[data-theme="light"]`: `--editor-surface: #fcfbf7;`
- In the shared `.title, .content, .preview` rule, change `background: transparent;` → `background: var(--editor-surface);`

The `.title` input, `#content` textarea, and `.preview` all get the same quiet card tone, so in edit/preview modes the area the editor covers is visible as a column against `--bg`. No border, no radius — subtle. Split mode is fine: the panes keep their own layout and the background just fills each pane.

**b) Ditch the scrollbar** — remove the styled scrollbar; keep scrolling functional:

- Delete the whole `/* --- scrollbars --- */` block (`::-webkit-scrollbar { width: 9px }`, thumb, hover, track rules).
- Delete the now-unused `--scrollbar-thumb` and `--scrollbar-thumb-hover` vars from `:root` and `[data-theme="light"]`.
- Add in its place:

```css
/* --- scrollbars: hidden, scrolling still works --- */
::-webkit-scrollbar { display: none; }
* { scrollbar-width: none; } /* Firefox */
```

All `overflow-y: auto` surfaces (`#content`, `.preview`, `.post-list`, history) keep scrolling via wheel/trackpad/keys — just no visible bar.

**c) Focus mode** — hide the footer, keep the header menus:

- Replace:
  ```css
  body.focus-mode .footer { opacity: 0.3; transition: opacity 0.2s ease; }
  body.focus-mode .footer:hover { opacity: 1; }
  body.focus-mode .topbar { opacity: 0; pointer-events: none; }
  ```
  with:
  ```css
  body.focus-mode .footer { display: none; }
  ```
- Deleting the `.topbar` rule is what makes ☰ and ⋯ stay visible in focus mode (the bar keeps its normal transparent-overlay look).
- Keep `body.focus-mode .sidebar { display: none; }` and all focus-mode JS in `app.js` unchanged (`openPosts()`/`openMore()` still exit focus mode, Esc still exits).

### 3. `src/server.test.ts` — presence assertions (follow existing conventions, e.g. the served-content checks around `:412`/`:420`)

Add small assertions to existing tests or sibling tests:

- Width test (`app.js contains reading time calculation and writing goal logic`): `expect(text).toContain("calc(100% - 96px)");` — locks the fluid wide value.
- New `style.css contains editable surface styles` test: `expect(text).toContain("--editor-surface");`
- New `style.css hides scrollbars` test: `expect(text).toContain("scrollbar-width: none");`
- Existing tests keep passing untouched — none assert the old px values (560/720/960), and `style.css contains focus-mode styles` still matches (`body.focus-mode .sidebar` and `body.focus-mode .footer` both remain in the file).

## Verification (judge by exit status, not output text)

1. `bun test` — full suite passes, including new presence assertions.
2. `node --check src/public/app.js` — exit 0 (guards against syntax regressions from the `applyTypeWidth` change).
3. Manual smoke — `bun run dev`, open `http://localhost:4501`:
   - `⋯` → Width: click **narrow** / **medium** / **wide**; **wide** spans nearly the whole viewport with ~48px gutters; **medium** is the new default (~860px); reload — choice persists.
   - No visible scrollbar in the textarea, preview, or post list; scroll wheel still scrolls.
   - The writing column (title + textarea, and preview in preview mode) shows a subtle card background distinct from the page, in both dark and light themes.
   - ⌘⇧F focus mode: footer disappears completely; ☰ and ⋯ stay visible and clickable; Esc or opening either menu exits focus mode as before.
