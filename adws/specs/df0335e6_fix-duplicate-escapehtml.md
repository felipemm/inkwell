# Fix duplicate `escapeHtml` declaration breaking app.js

## Problem

`index.html` loads `app.js` as `<script type="module" src="app.js">` (src/public/index.html:174). ES modules are strict mode, so duplicate top-level function declarations are a `SyntaxError`.

`src/public/app.js` declares `escapeHtml` twice at module top level:

- line 55 — inside the `// --- markdown ---` section
- line 387 — inside the `// --- history (pure) ---` section

The parser rejects the whole file:

```
:4501/app.js:387 Uncaught SyntaxError: Identifier 'escapeHtml' has already been declared
```

Because it is a parse error, **nothing in app.js runs** — the app is fully broken, not partially degraded.

Root cause of the duplication: the repo's test harness (`loadSection` in `src/server.test.ts:199`) slices a single `// --- <name> ---` section out of app.js and evaluates it standalone. Pure sections therefore must be self-contained, so the history (pure) section declared its own `escapeHtml`. That is fine in isolation, but collides when the whole file is parsed as a module.

Note: `bun test` currently passes even with the bug — the suite only slices sections, it never parses the whole file. The bug is invisible to the existing suite; that is why a regression gate is included below.

## Fix strategy

Rename the history section's local helper so the two sections no longer collide, keeping both sections self-contained (per the documented convention, e.g. `adws/specs/7f914799_fts5-search_v2.md`: pure sections "must not call `escapeHtml`"). Do **not** delete either declaration and do **not** hoist a single shared `escapeHtml` — both would break the `loadSection`-based tests for the section that lost its local copy.

## Files to touch

### 1. `src/public/app.js` (required)

In the `// --- history (pure) ---` section (starts at line 385):

- line 387: `function escapeHtml(s) {` → `function escapeHtmlText(s) {`
- line 399 (the only call site in that section): `${escapeHtml(text)}` → `${escapeHtmlText(text)}`

Leave line 55 and line 71 untouched (markdown section keeps `escapeHtml`).

Resulting `escapeHtml` references: 55 (decl), 71 (call) = markdown; 387 (decl), 399 (call) = history, renamed `escapeHtmlText`.

### 2. `src/server.test.ts` (required regression test)

Add a test near the other app.js content tests that guards against a second top-level `escapeHtml` declaration (this is the exact regression class that shipped the bug; the section-based tests cannot catch it):

```ts
test("app.js declares escapeHtml exactly once at top level (no module-scope redeclaration)", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();
  const decls = js.match(/^function escapeHtml\(/gm) ?? [];
  expect(decls).toHaveLength(1);
});
```

## Verification (judge by exit status)

1. Reproduce the bug on the unmodified file (optional sanity check):
   `node --check src/public/app.js` → exit 1, prints `SyntaxError: Identifier 'escapeHtml' has already been declared` at line 387. (Node parses `.js` as ESM because package.json has `"type": "module"`, so this is a faithful module-scope check. `bun build` does NOT catch this — it exits 0 either way, so do not use it as the gate.)
2. After the fix: `node --check src/public/app.js` → exit 0.
3. `bun test` → all pass (including the new regression test and the existing `history diff rendering escapes HTML and marks added/removed lines (pure section)` test, which loads the history (pure) section standalone — still self-contained with `escapeHtmlText`).
4. Manual smoke (optional): `bun run dev`, open `http://localhost:4501` (or whatever port the server uses), confirm no console SyntaxError and the editor renders.
