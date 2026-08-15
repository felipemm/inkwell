# Increase the medium type width by 30%

## Request

> increase the medium width by 30%

"Medium" is the `medium` option of the quiet-room type-width control (Appearance → Width in the `⋯` menu). It is currently **860px**; 30% more is **1118px** (860 × 1.3 = 1118). Medium stays the default, and users who already have `inkwell-type-width` saved keep their key — they just get the wider value.

## Changes

### 1. `src/public/app.js` — the width map (the actual change)

In the `// --- quiet room: type width ---` section (line ~395), change the `medium` entry:

```js
// before
const TYPE_WIDTHS = { narrow: 640, medium: 860, wide: 'calc(100% - 96px)' };
// after
const TYPE_WIDTHS = { narrow: 640, medium: 1118, wide: 'calc(100% - 96px)' };
```

- Use the literal `1118` (a plain number, matching the `narrow` entry). Do not write `Math.round(860 * 1.3)` — the file uses plain literals.
- `narrow` and `wide` stay untouched. `applyTypeWidth()` already appends `px` for numbers (`typeof v === 'number' ? \`${v}px\` : v`), so no other JS changes are needed.
- No HTML change: the three `.width-btn` buttons and their `data-width` attributes stay as-is.

### 2. `src/public/style.css` — keep the pre-JS fallback in sync

In `:root` (line ~25), the stylesheet default is still the original 720px:

```css
--editor-max-width: 720px;   /* before */
--editor-max-width: 1118px;  /* after */
```

This value is only visible before `app.js` runs (its inline style on `document.documentElement` always overrides it after load), but leaving it at 720 while the default is 1118 causes a wrong-width flash and a latent inconsistency. `--editor-max-width` is consumed only by `.title, .content, .preview` (line ~380), and split mode forces `max-width: none` — so this one-line sync is safe.

### 3. `src/server.test.ts` — lock the new value (repo convention)

In the test `app.js contains reading time calculation and writing goal logic` (line ~428, alongside the existing `TYPE_WIDTHS` / `calc(100% - 96px)` assertions), add:

```ts
expect(text).toContain("medium: 1118");
```

The served `app.js` contains the literal `medium: 1118` (same spacing — `medium: 1118,`), so the assertion matches. Do not assert on the old `860`.

## Do NOT touch (unrelated or historical)

- `src/public/style.css:514` — `@media (max-width: 860px)`: the **split-mode stacking breakpoint**, unrelated to the type-width `medium` value. Same for README's "Below ~860px viewport width" note.
- `src/server.ts:548` — ISO-8601 error string (unrelated).
- `adws/specs/*` and `adws/app_docs/*` — historical records describing the 860px value; do not rewrite history.

## Verification (judge by exit status, not output text)

1. `bun test` — full suite passes, including the new `medium: 1118` assertion. Exit status 0.
2. `node --check src/public/app.js` — exit 0 (syntax guard).
3. Manual smoke — `bun run dev`, open `http://localhost:4501`:
   - Default (no prior setting): writing column is ~1118px wide (noticeably wider than the old ~860px).
   - `⋯` → Width: click **narrow** / **medium** / **wide** — narrow still 640px, medium ~1118px, wide still fluid (`calc(100% - 96px)`); reload — choice persists.
   - Users with `inkwell-type-width` saved as `medium` see the new 1118px width on load (key unchanged, value bigger).
