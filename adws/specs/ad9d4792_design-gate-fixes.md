# Fix impeccable design-gate findings on src/public

## Goal

Make the design quality gate pass: `impeccable detect src/public` must exit 0 with no findings, by resolving the four finding classes currently reported on `src/public` (`skipped-heading`, `flat-type-hierarchy`, `dark-glow`, and `gpt-thin-border-wide-shadow` ×3 — the "thin-border" findings) **without changing the app's functionality or noticeably changing its look**.

## How the gate works and what it currently reports

The deterministic design check is defined in `adws/config/sssf.config.yaml` (`quality.checks[].name: design`, `surface: src/public`) and expands to:

```bash
impeccable detect src/public
```

Run from the repo root today, it exits **2** and prints 6 findings, all attributed to `src/public/index.html` (the static HTML engine folds the linked `style.css` into the HTML analysis):

1. **`skipped-heading`** (warning): `<h1> "inkwell" followed by <h3> "Appearance" (missing h2)`. The heading walk walks every `h1..h6` in DOM order and flags a level that jumps by more than one. DOM order is: brand `h1` (drawer) → four popover section `h3`s (Appearance, Writing, View, Post) → two modal `h2`s (Keyboard Shortcuts, History). The `h1 → h3` jump is the only violation.
2. **`flat-type-hierarchy`** (warning): `Sizes: 10.5px, 11.5px, 12px, 12.5px, 13px, 14px, 15px, 16px, 18px, 20px (ratio 1.9:1)`. The static page-typography check collects computed font sizes of text-bearing elements and fires when the max/min ratio is `< 2.0`. Current min is 10.5px (`.menu-heading` group labels, `.pane-label`), max is 20px (`.brand` wordmark and `.close-btn` × glyph). 20 / 10.5 = 1.9 → fail.
3. **`dark-glow`** (warning): `Zero-offset box-shadow glow (#6ee7b7)`. The CSS-text glow scan flags any zero-offset (offset-x = offset-y = 0) chromatic box/text shadow with blur > 4px. Both status dots carry one: `.dot.published` (`box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 55%, transparent)`, resolves to the accent glow) and `.dot.scheduled` (same shape with `--schedule`). Only the first is reported, but both must go.
4. **`gpt-thin-border-wide-shadow`** (advisory) ×3: `1px border + 32px shadow blur`. Fires when an element has ≥ 2 visible hairline border sides (≤ 1.5px, ≥ 0.28 alpha) AND a shadow blur ≥ 16px. Exactly three elements qualify: the `#more-menu` popover (`.popover`, 1px border on all sides) and the two `.modal-content` dialogs (shortcuts + history modals). Each pairs its 1px border with `--shadow-modal`, currently `0 12px 32px …` (blur 32 ≥ 16).

The fix set below was **verified on a scratch copy**: applying these exact edits makes `impeccable detect` print `[]` / nothing and exit 0. Do not fix these by adding entries to `.impeccable/config.json` (`ignoreRules` / `ignoreValues`) — the code is the right place, and the config is currently clean.

## Files to touch

Only two files change; `app.js` and everything else stay untouched.

### 1. `src/public/index.html` — fix `skipped-heading`

Change the four popover section headings from `h3` to `h2`, **both opening and closing tags** (the popover's grouped-control labels are interface sections at the same level as the modal titles that follow them in the document):

- Line ~73: `<h3 class="menu-heading">Appearance</h3>` → `<h2 class="menu-heading">Appearance</h2>`
- Line ~122: `<h3 class="menu-heading">Writing</h3>` → `<h2 class="menu-heading">Writing</h2>`
- Line ~130: `<h3 class="menu-heading">View</h3>` → `<h2 class="menu-heading">View</h2>`
- Line ~142: `<h3 class="menu-heading">Post</h3>` → `<h2 class="menu-heading">Post</h2>`

The outline becomes `h1` (brand) → `h2` ×6 (Appearance, Writing, View, Post, Keyboard Shortcuts, History) — no level jumps.

**Why there is no visual change:** `.menu-heading` (style.css line ~471) sets `margin`, `font-family`, `font-size: 10.5px`, `letter-spacing`, `text-transform`, and `color` by class; `h2` and `h3` have the same UA default bold weight, and nothing else in the stylesheet or `app.js` targets those elements by tag. Keep the class-based styles as-is; do not restyle them.

### 2. `src/public/style.css` — fix the remaining three finding classes

**(a) `.brand` font-size 20px → 22px** (fixes `flat-type-hierarchy`). In the `.brand` rule (currently lines ~281–291), change only `font-size: 20px;` to `font-size: 22px;`. Do **not** touch `.close-btn` (line ~772), which is also 20px. The scale's max/min becomes 22 / 10.5 ≈ 2.1 ≥ 2.0 → the check passes, and the serif wordmark gains a touch more presence. Nothing sizes off the brand text; sidebar layout has padding headroom, so no functional change.

**(b) Delete the glow `box-shadow` from `.dot.published`** (fixes `dark-glow`). In the `.dot.published` rule (currently lines ~376–380):

```css
.dot.published {
  background: var(--accent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 55%, transparent);
}
```

becomes

```css
.dot.published {
  background: var(--accent);
}
```

**(c) Delete the glow `box-shadow` from `.dot.scheduled`** (same `dark-glow` class; remove it so the scan stays clean). In the `.dot.scheduled` rule (currently lines ~889–893):

```css
.dot.scheduled {
  background: var(--schedule);
  box-shadow: 0 0 6px color-mix(in srgb, var(--schedule) 55%, transparent);
}
```

becomes

```css
.dot.scheduled {
  background: var(--schedule);
}
```

The status dots keep their colors (published = accent, scheduled = schedule) and their `.published` / `.scheduled` class names, which `app.js` toggles and which `src/server.test.ts` asserts exist. Only the zero-offset chromatic halo disappears.

**(d) Tighten `--shadow-modal` geometry** (fixes the three `gpt-thin-border-wide-shadow` findings). Replace the geometry in **all eight** `--shadow-modal` declarations from `0 12px 32px` to `0 4px 12px`, keeping each declaration's rgba color/alpha exactly as it is. The eight declarations are at style.css lines 23 (default dark `:root`), 49 (light), 70 (sepia), 91 (forest), 112 (midnight), 133 (ocean), 154 (rose), 175 (graphite) — `:root` plus the seven theme overrides. Simplest safe instruction: search the whole file for `0 12px 32px` and replace every occurrence (there are exactly 8; the drawer/popover/modal consumers only reference the `--shadow-modal` variable, never the literal value).

For example, the `:root` block (line ~23):

```css
--shadow-modal: 0 12px 32px rgba(0, 0, 0, 0.6);
```

becomes

```css
--shadow-modal: 0 4px 12px rgba(0, 0, 0, 0.6);
```

and likewise for each theme override, keeping its own rgba value.

**Why this is the right trade:** blur 12 < 16 clears the rule, the hairline borders that define these floating surfaces (essential on the light themes) stay, and the elevation shadow becomes a compact proximity cue instead of a wide diffuse halo — the "commit to the edge, soften the elevation" resolution the finding asks for. Consumers are unchanged because they all read the variable: `.drawer` (style.css ~447), `.popover` (~461), `.modal-content` (~748). The drawer (off-canvas panel, `border-right: 1px` only) was never flagged but uses the same variable, so it follows along and the overlay family stays visually consistent.

Note: historical spec docs under `adws/specs/` also quote the old `0 12px 32px` values — those are records, not code; leave them alone.

## Regression risks and why they are covered

- No JS changes: `app.js` untouched, so all editor behavior is unchanged.
- `src/server.test.ts` asserts CSS *contains* `.brand`, `.brand-icon`, `.dot.scheduled`, `.schedule-input`, `--schedule:` — every one of those remains present. Nothing in the test suite references `menu-heading`, `h3`, or the removed `box-shadow` lines (verified by search).
- `.dot` classes/colors and `app.js`'s use of them are preserved; only the halo is gone.
- Popover and modal surfaces keep their defined edges plus a subtler shadow; brand grows 20 → 22px (≈ +2px on the wordmark); group labels look pixel-identical.

## Verification (judge by exit status, not by scanning output text)

1. **Design gate (primary):**
   ```bash
   cd /work && impeccable detect src/public
   ```
   Expected: exit **0**, no findings printed. (Sanity: `impeccable detect src/public --json` prints `[]`.)
2. **Regression suite:** `bun test` → exit 0.
3. **Typecheck (fast sanity, untouched TS):** `bun x tsc --noEmit` → exit 0.
4. **Manual smoke (optional but recommended):** `bun run dev`, open the app. Expect: brand slightly larger; drawer/popover/modal shadows subtler; status dots colored but no glow halo; popover group labels ("Appearance", "Writing", "View", "Post") visually unchanged.

## Deliverable

Changed files: `src/public/index.html`, `src/public/style.css`. Do not commit — the factory commits. Report both changed files in your envelope, and note that the design gate command above is the verification the reviewer should rerun.
