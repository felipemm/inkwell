# Enter in the title moves focus to the text area

## Request

> when on typing the title, hitting enter moves to the text area

In the editor, pressing Enter while focused in the title field should move the cursor into the content textarea so the writer can start the body without touching the mouse/tab.

## Current state

- `src/public/index.html`: the editor has `<input id="title" class="title" type="text" placeholder="Untitled" …>` followed by `<textarea id="content" class="content" …>` inside `#panes`.
- `src/public/app.js`: `ui.title = el('title')` and `ui.content = el('content')` are already defined. The events section has `ui.title.addEventListener('input', scheduleSave);` (≈line 609) but **no keydown handler on the title** — pressing Enter in the single-line input currently does nothing (there is no wrapping `<form>`, so no implicit submit).
- The document-level keydown handler in `app.js` already maps `(e.metaKey || e.ctrlKey) && e.key === 'Enter'` to `cycleViewMode()` — that must keep working.
- Existing convention: frontend behaviors are covered by presence assertions in `src/server.test.ts` (e.g. `"app.js cycles view mode on Cmd+Enter"` fetches `/app.js` and asserts on substrings). Follow that pattern.

## Changes

### 1. `src/public/app.js` — Enter in title focuses the content textarea

In the `// --- events ---` section, immediately after the existing line:

```js
ui.title.addEventListener('input', scheduleSave);
```

add:

```js
ui.title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    ui.content.focus();
  }
});
```

- Plain Enter moves focus to `#content`; `ui.content.focus()` places the caret in the textarea.
- The modifier guard is required: `Cmd/Ctrl+Enter` is reserved at document level for cycling view mode (edit → split → preview). Because the title's own handler fires before the document handler, guarding on `metaKey`/`ctrlKey` keeps that shortcut working unchanged when focus is in the title. `Shift`/`Alt` are also excluded so only an unmodified Enter triggers the move.
- `e.preventDefault()` stops any default single-line-input behavior (none today, but keeps the behavior explicit and future-proof).
- No HTML change needed — `#title` and `#content` already exist with those ids.

### 2. `src/server.test.ts` — presence assertion (follow existing conventions)

Add a test near the other frontend presence tests (e.g. right after `"app.js cycles view mode on Cmd+Enter"`):

```ts
test("app.js moves focus from title to content on plain Enter", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("ui.title.addEventListener('keydown'");
  expect(text).toContain("ui.content.focus()");
});
```

## Out of scope

- No change to the shortcuts modal (`#shortcuts-modal`): that lists global shortcuts; this is a contextual form-flow behavior, not a global one.
- No server/API changes; no CSS changes.

## Verification (judge by exit status, not output text)

1. `bun test` — full suite passes, including the new `"app.js moves focus from title to content on plain Enter"` test.
2. `node --check src/public/app.js` — exit 0 (syntax guard for the new listener).
3. Manual smoke — `bun run dev`, open `http://localhost:4501`:
   - Click a post (or `+ new`), click into the title field, type something, press **Enter** → focus moves into the text area and you can type the body immediately.
   - With focus still in the title, press **⌘Enter / CtrlEnter** → view mode still cycles (edit → split → preview), and focus does NOT move to the text area.
   - Tab still works as before between fields.
