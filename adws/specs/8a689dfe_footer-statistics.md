# Add more statistics in the footer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new live readouts — character count, paragraph count, sentence count — to the editor footer, next to the existing word count and reading time, so a writer sees a fuller picture of the draft at a glance.

**Architecture:** All three stats are computed client-side on every keystroke from the textarea value by three new pure functions (`countChars`, `countParagraphs`, `countSentences`) living in a dedicated `// --- footer statistics (pure) ---` section of `app.js` — the repo's `loadSection` test helper extracts and executes that section directly. `updateWordCount()`, which already runs on editor render and on every content `input` event, is extended to write the three new spans. The readouts are static `.meta` spans in the footer, so **no CSS changes are needed** and there are no server, API, or DB changes.

**Tech Stack:** Vanilla JS + static HTML, zero dependencies (repo README: "zero dependencies"). No new files.

**Spec:** `adws/specs/8a689dfe_footer-statistics.md` (this document, also at the session `context_handoff/plan.md`).

## Global Constraints

- **Zero new dependencies** — three pure JS functions and three static spans only. No libraries, no new files.
- **Client-side only.** Do NOT touch `src/server.ts`, the SQLite schema, or any `/api/*` route. The existing `/api/posts/:id/stats` and `/api/stats` endpoints stay exactly as they are.
- **Pure functions must be DOM-free and live in one section** named exactly `footer statistics (pure)` — the `section()` helper in `src/server.test.ts` finds sections by `// --- <name>`, so the marker line must be `// --- footer statistics (pure) ---`. `loadSection` evaluates that section with `new Function`, so it cannot reference `ui`, `document`, or `window`.
- **No duplicate declarations.** Before adding, verify `countChars`, `countParagraphs`, `countSentences` do not already exist in `app.js` (they don't today; grep to confirm — the repo has a history of duplicate-declaration regressions, see `adws/specs/df0335e6_fix-duplicate-escapehtml.md`).
- **Preserve existing footer semantics.** Word count, reading time (`calcReadingTime`), save-state, the spacer, the schedule input/button, and the history button are untouched. The three new spans are inserted after `#reading-time`; `updateWordCount` is extended, never replaced.
- **Pluralization** follows the existing pattern: `${n} ${n === 1 ? 'word' : 'words'}` → `char`/`chars`, `paragraph`/`paragraphs`, `sentence`/`sentences`.
- **Do NOT modify `src/public/style.css`.** The `.meta` class already styles the new spans; the footer flex row accommodates the extra readouts. No `bun test` assertion targets CSS for this feature.
- **Do NOT modify existing tests.** The existing tests at `src/server.test.ts:455` (`"index.html contains writing goal, reading time, and font size elements"`) and `:469` (`"app.js contains reading time calculation and writing goal logic"`) keep passing untouched — the new IDs and functions are additive. Only add new tests.
- All tests live in `src/server.test.ts` as served-content / `loadSection` behavioral tests (repo convention). `bun test` must exit 0. Judge commands by exit status, never by scanning output text for words like "error".

## File Structure

| File | Change |
| --- | --- |
| `src/public/index.html` | Insert three `.meta` spans (`#char-count`, `#para-count`, `#sentence-count`) in the editor `.footer` immediately after the `#reading-time` span (currently line 58). |
| `src/public/app.js` | Three spots: (1) three `ui` map entries after `readingTime: el('reading-time')` (line 17); (2) a new `// --- footer statistics (pure) ---` section with the three counting functions, placed right after the `countWords` const (line 167); (3) extend `updateWordCount()` (lines 243–250) to write the three new spans. |
| `src/server.test.ts` | Three new tests inserted immediately after the closing `});` of the `"app.js contains reading time calculation and writing goal logic"` test (currently ends around line 475). |
| `README.md` | Line 41: extend the **Editor footer** bullet to mention the three new readouts. |

---

### Task 1: Footer readout markup + HTML contract test

**Files:**
- Modify: `src/public/index.html` — editor `.footer` (currently lines 55–63)
- Modify: `src/server.test.ts` — new test after the `"app.js contains reading time calculation and writing goal logic"` test
- Test: the new test itself

**Interfaces:**
- Produces: three spans with ids `char-count`, `para-count`, `sentence-count`, classes `meta`, inside the editor `<footer class="footer">`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing HTML test**

Insert this test after the closing `});` of the `"app.js contains reading time calculation and writing goal logic"` test (currently `src/server.test.ts` lines 469–475):

```ts
test("index.html contains footer statistics readouts (chars, paragraphs, sentences)", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const html = await res.text();
  // the readouts live in the editor footer (last </footer> in the document)
  const footer = html.slice(html.indexOf('<footer class="footer">'), html.lastIndexOf("</footer>"));
  expect(footer).toContain('id="char-count"');
  expect(footer).toContain('id="para-count"');
  expect(footer).toContain('id="sentence-count"');
});
```

(The `footer` slice pattern matches the existing history/schedule footer tests at `src/server.test.ts:1367` and `:1619`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — `id="char-count"` etc. not found in the served HTML.

- [ ] **Step 3: Add the three spans to the footer**

In `src/public/index.html`, inside `<footer class="footer">`, immediately after:

```html
    <span id="reading-time" class="meta"></span>
```

add:

```html
    <span id="char-count" class="meta">0 chars</span>
    <span id="para-count" class="meta">0 paragraphs</span>
    <span id="sentence-count" class="meta">0 sentences</span>
```

The footer now reads (left group, before the spacer):

```html
    <span id="word-count" class="meta">0 words</span>
    <span id="reading-time" class="meta"></span>
    <span id="char-count" class="meta">0 chars</span>
    <span id="para-count" class="meta">0 paragraphs</span>
    <span id="sentence-count" class="meta">0 sentences</span>
    <span id="save-state" class="meta save-state">saved</span>
    <span class="spacer"></span>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test`
Expected: PASS for the new test; existing tests untouched and still passing.

- [ ] **Step 5: Commit**

```bash
git add src/public/index.html src/server.test.ts
git commit -m "feat: add char, paragraph, and sentence readouts to the editor footer"
```

---

### Task 2: Pure counting functions in app.js

**Files:**
- Modify: `src/public/app.js` — new section immediately after the `countWords` const (line 167)
- Modify: `src/server.test.ts` — new test after the Task 1 test
- Test: the new test itself

**Interfaces:**
- Produces (consumed by Task 3 and by the test):
  - `countChars(text: string): number` — `text.length` of the raw value.
  - `countParagraphs(text: string): number` — trimmed; 0 for empty/whitespace; otherwise number of blank-line-separated blocks: `trimmed.split(/\n\s*\n/).length`. Consecutive blank lines collapse into one separator; leading/trailing blank lines are trimmed away.
  - `countSentences(text: string): number` — trimmed; 0 for empty/whitespace; otherwise number of non-empty segments split on sentence-ending punctuation: `trimmed.split(/[.!?…]+(?=\s|$)/).filter((s) => s.trim().length > 0).length`. Any non-empty text without terminal punctuation counts as 1; punctuation-only text (e.g. `"..."`) counts as 0.
- Consumes: nothing (DOM-free by constraint).

- [ ] **Step 1: Write the failing behavioral test**

Insert this test immediately after the Task 1 test:

```ts
test("footer statistics counters: countChars, countParagraphs, countSentences (pure section)", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();

  const { countChars, countParagraphs, countSentences } = loadSection<any>(js, "footer statistics (pure)", [
    "countChars",
    "countParagraphs",
    "countSentences",
  ]);

  expect(countChars("")).toBe(0);
  expect(countChars("hello world")).toBe(11);
  expect(countChars("a\nb")).toBe(3);

  expect(countParagraphs("")).toBe(0);
  expect(countParagraphs("   ")).toBe(0);
  expect(countParagraphs("one")).toBe(1);
  expect(countParagraphs("one\n\ntwo")).toBe(2);
  expect(countParagraphs("one\n\n\ntwo")).toBe(2);
  expect(countParagraphs("one\n\ntwo\n\n")).toBe(2);

  expect(countSentences("")).toBe(0);
  expect(countSentences("Hi there")).toBe(1);
  expect(countSentences("Hello world.")).toBe(1);
  expect(countSentences("Hello. World!")).toBe(2);
  expect(countSentences("One. Two. Three?")).toBe(3);
  expect(countSentences("...")).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — `section "footer statistics (pure)" not found in app.js` (the `section()` helper throws).

- [ ] **Step 3: Add the pure section**

In `src/public/app.js`, immediately after the `countWords` line:

```js
const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
```

add:

```js
// --- footer statistics (pure) ------------------------------------------------------
const countChars = (text) => text.length;

const countParagraphs = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\n\s*\n/).length;
};

const countSentences = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/[.!?…]+(?=\s|$)/).filter((s) => s.trim().length > 0).length;
};
```

Keep the marker line exactly `// --- footer statistics (pure) ---...` — the test helper looks up `// --- footer statistics (pure)` by prefix, and the section must end at the next `// --- ` marker (`// --- rendering ---`), so do not move or rename markers.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test`
Expected: PASS for the new pure-section test.

- [ ] **Step 5: Commit**

```bash
git add src/public/app.js src/server.test.ts
git commit -m "feat: add pure footer statistics counters"
```

---

### Task 3: Wire the readouts into updateWordCount

**Files:**
- Modify: `src/public/app.js` — `ui` map (after line 17) and `updateWordCount()` (lines 243–250)
- Modify: `src/server.test.ts` — new test after the Task 2 test
- Test: the new test itself

**Interfaces:**
- Consumes: `countChars`, `countParagraphs`, `countSentences` from the Task 2 section; the `char-count`, `para-count`, `sentence-count` spans from Task 1.
- Produces: `ui.chars`, `ui.paras`, `ui.sentences` entries; `updateWordCount()` writes all three spans on every call (editor render + every content input).

- [ ] **Step 1: Write the failing wiring test**

Insert this test immediately after the Task 2 test:

```ts
test("app.js wires the new footer readouts into updateWordCount", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();
  expect(js).toContain("ui.chars.textContent");
  expect(js).toContain("ui.paras.textContent");
  expect(js).toContain("ui.sentences.textContent");
  expect(js).toContain("countChars(ui.content.value)");
  expect(js).toContain("countParagraphs(ui.content.value)");
  expect(js).toContain("countSentences(ui.content.value)");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — none of the wired strings exist in app.js yet.

- [ ] **Step 3: Add the ui map entries**

In `src/public/app.js`, in the `ui` object, immediately after:

```js
  readingTime: el('reading-time'),
```

add:

```js
  chars: el('char-count'),
  paras: el('para-count'),
  sentences: el('sentence-count'),
```

- [ ] **Step 4: Extend updateWordCount**

Replace the whole current `updateWordCount()` function:

```js
function updateWordCount() {
  const n = countWords(ui.content.value);
  ui.words.textContent = `${n} ${n === 1 ? 'word' : 'words'}`;
  const minutes = calcReadingTime(n);
  ui.readingTime.textContent = minutes ? `${minutes} min read` : '';
  updateGoal();
  updateTotals();
}
```

with:

```js
function updateWordCount() {
  const n = countWords(ui.content.value);
  ui.words.textContent = `${n} ${n === 1 ? 'word' : 'words'}`;
  const minutes = calcReadingTime(n);
  ui.readingTime.textContent = minutes ? `${minutes} min read` : '';

  const chars = countChars(ui.content.value);
  ui.chars.textContent = `${chars} ${chars === 1 ? 'char' : 'chars'}`;
  const paras = countParagraphs(ui.content.value);
  ui.paras.textContent = `${paras} ${paras === 1 ? 'paragraph' : 'paragraphs'}`;
  const sentences = countSentences(ui.content.value);
  ui.sentences.textContent = `${sentences} ${sentences === 1 ? 'sentence' : 'sentences'}`;

  updateGoal();
  updateTotals();
}
```

No new event listeners are needed — `updateWordCount` is already called by `renderEditor()` (on post load) and by the `#content` `input` handler, so the readouts update on every keystroke and whenever a post is opened.

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: exit 0 — all tests pass, including the three new ones and all pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add src/public/app.js src/server.test.ts
git commit -m "feat: wire footer statistics into the live word-count update"
```

---

### Task 4: README + full verification

**Files:**
- Modify: `README.md` (line 41)
- Test: the full suite, manual smoke test

- [ ] **Step 1: Update the README**

In `README.md`, under **Quiet Room Layout**, change the **Editor footer** bullet from:

```md
- **Editor footer**: readouts only — word count, reading time (`N min read`), and auto-save status (`saved`/`saving`).
```

to:

```md
- **Editor footer**: readouts only — word count, reading time (`N min read`), character count, paragraph count, sentence count, and auto-save status (`saved`/`saving`).
```

- [ ] **Step 2: Run the whole test suite**

Run: `bun test`
Expected: exit 0, all tests pass.

- [ ] **Step 3: Manual smoke test**

Run: `bun run dev`, open `http://localhost:4501`, and paste this into the editor:

```
Hello world. This is a draft.

Second paragraph!
```

1. The footer shows `8 words · 1 min read · 48 chars · 2 paragraphs · 3 sentences · saved` (chars includes spaces and newlines; sentences counts the three terminal-punctuation groups; 8 words → ceil(8/200) = 1 min read).
2. Delete everything → footer shows `0 words · 0 chars · 0 paragraphs · 0 sentences · saved`; reading time stays blank.
3. Type a single word with no punctuation (e.g. `draft`) → `1 word · 1 char · 1 paragraph · 1 sentence` (sentence counts any non-empty text without terminal punctuation as 1).
4. Reload the page → the post reopens and the same readouts render immediately (they come from `renderEditor()` → `updateWordCount()`).
5. The schedule input, schedule button, and history button still work; focus mode (⌘⇧F) still dims the whole footer as before.
6. On a narrow window the footer may overflow horizontally — acceptable, out of scope for this ticket; do not add CSS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the footer statistics readouts"
```

- [ ] **Step 5: Commit any leftover fixups** (only if a step above surfaced a bug)

```bash
git add -A
git commit -m "fix: footer statistics follow-ups"
```

---

## Self-Review

- **Spec coverage:** request = "add more statistics in the footer". Task 1 adds the three readout spans (chars, paragraphs, sentences) to the footer; Task 2 defines the counting semantics as pure functions; Task 3 wires them into the existing live update path; Task 4 documents and verifies. ✓
- **Placeholder scan:** every step contains exact code, exact test code, or exact commands; no TBD/TODO. ✓
- **Type consistency:** ids in Task 1 (`char-count`, `para-count`, `sentence-count`) match the `ui` entries in Task 3 (`ui.chars`, `ui.paras`, `ui.sentences`), which match the wiring test's asserted strings (`ui.chars.textContent`, `countChars(ui.content.value)`, …). Function names (`countChars`, `countParagraphs`, `countSentences`) are identical across Tasks 2 and 3. Section name `footer statistics (pure)` matches the `loadSection` call. ✓
- **Behavioral pinning:** test expectations in Task 2 match the exact implementations in Task 2 Step 3, verified by hand (e.g. `"hello world"` → 11 chars; `"one\n\n\ntwo"` → 2 paragraphs; `"Hello. World!"` → 2 sentences; `"..."` → 0 sentences). Smoke-test numbers in Task 4 recompute to the stated values. ✓
- **Back-compat:** no existing test is modified; no server/API/DB/CSS change; existing footer controls and readouts are untouched; `updateWordCount` keeps its call sites and final `updateGoal()`/`updateTotals()` calls. ✓
- **Known limitation (documented, not fixed):** `countSentences` counts abbreviation periods as sentence ends (e.g. `"e.g. apples"` → 2). This matches the app's minimalist counter philosophy; do not add abbreviation handling in this ticket.
