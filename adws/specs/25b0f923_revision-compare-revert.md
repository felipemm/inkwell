# Post Revision History — Versioned Edits with Compare and Revert

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps between the current revision-history implementation and the spec in `adws/prompts/11-post-revision-history--versioned-edits-w.md`: the revisions list gains `title` + `summary`, a new `compare` endpoint diffs two revisions with counts and word delta, and a new `revert` route restores a snapshot (aliasing the existing `restore`).

**Architecture:** The feature is already ~80% built (`02-revision-history.md` era): the `revisions` table, `snapshotPost()` with 60s edit coalescing and the 50-revision cap, list/single/diff/restore routes, and the UI panel all exist. This plan only (1) reshapes the list response, (2) adds `GET /api/posts/:id/revisions/:a/compare/:b`, and (3) adds `POST /api/posts/:id/revisions/:rev/revert`. All routes live in `handleApi()` in `src/server.ts`, reuse the existing `lineDiff()`, `wordCount()`, `snapshotPost()`, `json()`, and `notFound()` helpers, and follow the existing route-matching style (segment-length + method checks). Tests live in `src/server.test.ts` (real server over a throwaway `INKWELL_DB` sqlite file).

**Tech Stack:** Bun + bun:sqlite, TypeScript (strict), zero dependencies, `bun test` for the suite, `bun x tsc --noEmit` for typecheck. Hand-written deterministic LCS line diff already exists (`lineDiff` in `src/server.ts`) — reuse it; no new dependency.

**Spec:** `adws/prompts/11-post-revision-history--versioned-edits-w.md` (read it; the plan argues from it). The prior implementation spec was `adws/prompts/02-revision-history.md`; the current code satisfies most of it already.

## Global Constraints

- **No new dependencies.** Diff is the existing hand-written `lineDiff`; no LCS library.
- **No destructive DB changes.** Do not create a second `post_revisions` table, do not rename `revisions`, do not drop/alter columns. The existing `revisions` table already has every column the spec lists (id, post_id, title, content, created_at, word_count) plus the pre-existing `reason` column. The migration test at `src/server.test.ts:1189-1199` asserts `PRAGMA table_info(revisions)` == `["id", "post_id", "title", "content", "word_count", "reason", "created_at"]` — it must stay green untouched. FK is enforced application-side (the DELETE-post route already runs `DELETE FROM revisions WHERE post_id = ?`).
- **Preserve existing endpoints and rows.** `/diff` and `/restore` stay as-is. `compare` and `revert` are additions.
- **No UI changes.** The editor history panel (`src/public/app.js`) reads `reason` and `word_count` from the revisions list (lines 557, 571), so the list response must keep `reason`. Out of scope per the spec: UI/editor, tags, auth, pagination.
- **JSON conventions** follow `src/server.ts`: success = `json(body)`; unknown resource = `json({ error: "not found" }, 404)`; bad method = `json({ error: "method not allowed" }, 405)`; non-integer ids = `notFound()`.
- **Word count** = whitespace-split words, via the existing `wordCount()`.
- **Revisions are immutable** — no update/delete revision endpoints.
- **Verification:** the whole suite must stay green: `bun test` and `bun x tsc --noEmit`. (Note: `bun` may not be on your shell PATH; if `bun: command not found`, source the Bun env first — `source ~/.bashrc` or `export PATH="$HOME/.bun/bin:$PATH"` — or use the operator shell where bun is live.)

## Decisions (read before Task 1)

1. **Table name stays `revisions`, not `post_revisions`.** The spec's schema bullet describes a table holding revisions; `revisions` already exists with exactly those columns (+`reason`). Creating a duplicate `post_revisions` table or renaming would be non-additive churn and would break the migration test. Nothing to do.
2. **List shape is `{id, created_at, title, word_count, reason, summary}`.** The spec requires `id, created_at, title, word_count, summary`; `reason` is kept because the existing UI renders it from this list and the spec forbids UI changes. `summary` = first 80 chars of the snapshot's content.
3. **`revert` snapshots the pre-revert state with reason `"restore"`.** The spec says the current state becomes a revision "same rule as an edit"; the existing restore behavior (never-coalescing `snapshotPost(post, "restore")`) is exactly that, and the UI maps `"restore"` → `"restored"`. Introducing a new `"revert"` reason would change the UI label for no functional gain.
4. **`compare` direction:** `:a` is the "from" revision, `:b` is the "to" revision. `diff` = `lineDiff(a.content, b.content)` (`+` = lines only in `b`, `-` = lines only in `a`). `word_delta` = `wordCount(b.content) - wordCount(a.content)`. Response: `{ diff, added, removed, word_delta }`.

---

### Task 1: Revisions list gains `title` and `summary`

**Files:**
- Modify: `src/server.ts` — the `/api/posts/:id/revisions` block (currently lines 584-592)
- Modify: `src/server.test.ts` — the test at line 1260 (`GET /api/posts/:id/revisions returns newest-first …`)

**Interfaces:**
- Consumes: existing `json()`, `notFound()`, `getPost()`, `db()`.
- Produces: list rows shaped `{ id: number, created_at: string, title: string, word_count: number, reason: string, summary: string }`, newest first (ORDER BY id DESC). `summary` is `content.slice(0, 80)`.

- [ ] **Step 1: Update the failing test** — replace the whole test at `src/server.test.ts:1260` (`GET /api/posts/:id/revisions returns newest-first {id, created_at, word_count, reason}`) with:

```ts
test("GET /api/posts/:id/revisions returns newest-first {id, created_at, title, word_count, reason, summary}", async () => {
  const created = await (await post("/posts", { title: "L", content: "one" })).json();
  await put(`/posts/${created.id}`, { content: "two" });
  const db = new Database(process.env.INKWELL_DB!);
  db.run("UPDATE revisions SET created_at = '2020-01-01T00:00:00.000Z'"); // force append
  db.close();
  await put(`/posts/${created.id}`, { content: "three" });

  const res = await api(`/posts/${created.id}/revisions`);
  expect(res.status).toBe(200);
  const list = await res.json();
  expect(list.length).toBe(2);
  expect(Object.keys(list[0]).sort()).toEqual(
    ["created_at", "id", "reason", "summary", "title", "word_count"].sort(),
  );
  expect(list[0].id).toBeGreaterThan(list[1].id); // newest first
  expect(list[0].reason).toBe("edit");
  expect(list[0].word_count).toBe(1); // pre-edit content "two" → one word
  expect(list[0].title).toBe("L"); // snapshot holds the pre-edit title
  expect(list[0].summary).toBe("two"); // first ~80 chars of the pre-edit content
  expect(typeof list[0].created_at).toBe("string");
  expect(list[0]).not.toHaveProperty("content"); // summaries only — no full content

  const missing = await api("/posts/999999/revisions");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/server.test.ts -t "revisions returns newest-first"`
Expected: FAIL — key-set mismatch (`title`/`summary` missing from actual keys).

- [ ] **Step 3: Implement the list shape change** — in `src/server.ts`, replace the body of the `/api/posts/:id/revisions` block (lines 584-592) with:

```ts
  // /api/posts/:id/revisions
  if (segments.length === 4 && segments[3] === "revisions") {
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    if (!getPost(id)) return notFound();
    const rows = db()
      .query("SELECT id, title, content, created_at, word_count, reason FROM revisions WHERE post_id = ? ORDER BY id DESC")
      .all(id) as { id: number; title: string | null; content: string | null; created_at: string; word_count: number; reason: string }[];
    return json(
      rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        title: r.title ?? "",
        word_count: r.word_count,
        reason: r.reason,
        summary: (r.content ?? "").slice(0, 80),
      })),
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/server.test.ts -t "revisions returns newest-first"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: include title and summary in the revisions list"
```

---

### Task 2: Compare two revisions

**Files:**
- Modify: `src/server.ts` — insert a new route block after the `/restore` block (after line 639, before the `/api/posts/:id` block at line 641)
- Modify: `src/server.test.ts` — add a new test after the existing `GET /api/posts/:id/revisions/:rev/diff` test (line 1343)

**Interfaces:**
- Consumes: `lineDiff(oldText, newText)` → `{ op: "+" | "-" | " "; text: string }[]` (already exported from `src/server.ts`), `wordCount()`, `getPost()`, `Revision` type, `json()`, `notFound()`.
- Produces: `GET /api/posts/:id/revisions/:a/compare/:b` → `200 { diff: {op,text}[], added: number, removed: number, word_delta: number }`. Errors: non-integer `:a`/`:b` → 404; unknown post → 404; revision id unknown anywhere in the DB → 404; revision exists but `post_id !== :id` → `400 { error: "revision does not belong to this post" }`.

- [ ] **Step 1: Write the failing test** — append this test to `src/server.test.ts` right after the `GET /api/posts/:id/revisions/:rev/diff` test (which ends around line 1370):

```ts
test("GET /api/posts/:id/revisions/:a/compare/:b diffs two snapshots with counts and word delta", async () => {
  const created = await (await post("/posts", { title: "C", content: "one\ntwo\nthree" })).json();
  await put(`/posts/${created.id}`, { content: "one\nTWO\nthree\nfour" });
  const db = new Database(process.env.INKWELL_DB!);
  db.run("UPDATE revisions SET created_at = '2020-01-01T00:00:00.000Z'"); // force append
  db.close();
  await put(`/posts/${created.id}`, { content: "five six" });

  // newest first: [snapshot("one\nTWO\nthree\nfour"), snapshot("one\ntwo\nthree")]
  const list = await (await api(`/posts/${created.id}/revisions`)).json();
  expect(list.length).toBe(2);
  const a = await (await api(`/posts/${created.id}/revisions/${list[1].id}`)).json();
  const b = await (await api(`/posts/${created.id}/revisions/${list[0].id}`)).json();
  expect(a.content).toBe("one\ntwo\nthree");
  expect(b.content).toBe("one\nTWO\nthree\nfour");

  const res = await api(`/posts/${created.id}/revisions/${a.id}/compare/${b.id}`);
  expect(res.status).toBe(200);
  const cmp = await res.json();
  expect(cmp.diff).toEqual([
    { op: " ", text: "one" },
    { op: "-", text: "two" },
    { op: "+", text: "TWO" },
    { op: " ", text: "three" },
    { op: "+", text: "four" },
  ]);
  expect(cmp.added).toBe(2); // "+" lines
  expect(cmp.removed).toBe(1); // "-" lines
  expect(cmp.word_delta).toBe(1); // wordCount(b) - wordCount(a) = 4 - 3

  // same revision on both sides → empty change, all context lines
  const same = await (await api(`/posts/${created.id}/revisions/${a.id}/compare/${a.id}`)).json();
  expect(same.added).toBe(0);
  expect(same.removed).toBe(0);
  expect(same.word_delta).toBe(0);
  expect(same.diff.length).toBeGreaterThan(0);
  expect(same.diff.every((op: any) => op.op === " ")).toBe(true);

  // unknown revision id → 404
  const unknown = await api(`/posts/${created.id}/revisions/999999/compare/${a.id}`);
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ error: "not found" });

  // a revision that exists but belongs to another post → 400
  const other = await (await post("/posts", { title: "O", content: "x" })).json();
  const cross = await api(`/posts/${other.id}/revisions/${a.id}/compare/${b.id}`);
  expect(cross.status).toBe(400);
  expect((await cross.json()).error).toBeTruthy();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/server.test.ts -t "compare/:b diffs two snapshots"`
Expected: FAIL — 404/`not found` (route does not exist yet).

- [ ] **Step 3: Implement the compare route** — insert this block into `src/server.ts` directly after the `/api/posts/:id/revisions/:rev/restore` block (after its closing brace, which is at line 639), before the `// /api/posts/:id` block:

```ts
  // /api/posts/:id/revisions/:a/compare/:b — diff between two snapshots
  if (segments.length === 7 && segments[3] === "revisions" && segments[5] === "compare") {
    const aId = Number(segments[4]);
    const bId = Number(segments[6]);
    if (!Number.isInteger(aId) || !Number.isInteger(bId)) return notFound();
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const a = db().query("SELECT * FROM revisions WHERE id = ?").get(aId) as Revision | null;
    if (!a) return notFound();
    const b = db().query("SELECT * FROM revisions WHERE id = ?").get(bId) as Revision | null;
    if (!b) return notFound();
    if (a.post_id !== id || b.post_id !== id) {
      return json({ error: "revision does not belong to this post" }, 400);
    }
    const diff = lineDiff(a.content ?? "", b.content ?? "");
    return json({
      diff,
      added: diff.filter((d) => d.op === "+").length,
      removed: diff.filter((d) => d.op === "-").length,
      word_delta: wordCount(b.content ?? "") - wordCount(a.content ?? ""),
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/server.test.ts -t "compare/:b diffs two snapshots"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: add compare endpoint for two revisions"
```

---

### Task 3: Revert route (aliases restore) + 404 coverage

**Files:**
- Modify: `src/server.ts` — insert a new route block next to the `/restore` block (after line 639)
- Modify: `src/server.test.ts` — add a new test after the restore test (line 1371) and extend the "unknown id returns 404" test (line 150)

**Interfaces:**
- Consumes: `snapshotPost(post, reason)`, `getPost()`, `now()`, `Revision` type, `json()`, `notFound()`.
- Produces: `POST /api/posts/:id/revisions/:rev/revert` → `200` with the updated post (`{id, title, content, status, target_word_count, publish_at, created_at, updated_at}`). Behavior: look up the post (404 if missing), look up the revision scoped to the post (404 if missing or belongs to another post), `snapshotPost(post, "restore")` to record the pre-revert state, then `UPDATE posts SET title=?, content=?, updated_at=?` from the snapshot, return the refreshed post. `/restore` is untouched.

- [ ] **Step 1: Write the failing test** — append this test to `src/server.test.ts` right after the existing restore test (which ends around line 1400):

```ts
test("POST /api/posts/:id/revisions/:rev/revert restores content and snapshots the pre-revert state", async () => {
  const created = await (await post("/posts", { title: "V", content: "one" })).json();
  await put(`/posts/${created.id}`, { content: "two" });
  const db = new Database(process.env.INKWELL_DB!);
  db.run("UPDATE revisions SET created_at = '2020-01-01T00:00:00.000Z'"); // force append
  db.close();
  await put(`/posts/${created.id}`, { content: "three" });

  const list = await (await api(`/posts/${created.id}/revisions`)).json();
  const revTwo = await (await api(`/posts/${created.id}/revisions/${list[0].id}`)).json();
  expect(revTwo.content).toBe("two"); // newest snapshot holds the pre-edit state of the last PUT

  await Bun.sleep(5);
  const before = await (await api(`/posts/${created.id}`)).json();

  const res = await post(`/posts/${created.id}/revisions/${revTwo.id}/revert`);
  expect(res.status).toBe(200);
  const reverted = await res.json();
  expect(reverted.title).toBe("V");
  expect(reverted.content).toBe("two");
  expect(reverted.updated_at > before.updated_at).toBe(true);

  // the pre-revert state ("three") was snapshotted first — a revert is undoable
  const after = await (await api(`/posts/${created.id}/revisions`)).json();
  expect(after.length).toBe(3);
  expect(after[0].reason).toBe("restore");
  const preRevert = await (await api(`/posts/${created.id}/revisions/${after[0].id}`)).json();
  expect(preRevert.content).toBe("three");

  // unknown post, unknown revision, and cross-post revision → 404
  expect((await post(`/posts/999999/revisions/${revTwo.id}/revert`)).status).toBe(404);
  expect((await post(`/posts/${created.id}/revisions/999999/revert`)).status).toBe(404);
  const other = await (await post("/posts", { title: "O", content: "x" })).json();
  expect((await post(`/posts/${other.id}/revisions/${revTwo.id}/revert`)).status).toBe(404);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/server.test.ts -t "revert restores content"`
Expected: FAIL — 404/`not found` (route does not exist yet).

- [ ] **Step 3: Implement the revert route** — insert this block into `src/server.ts` directly after the `/restore` block (after its closing brace at line 639):

```ts
  // /api/posts/:id/revisions/:rev/revert — spec name for the restore contract
  if (segments.length === 6 && segments[3] === "revisions" && segments[5] === "revert") {
    const revId = Number(segments[4]);
    if (!Number.isInteger(revId)) return notFound();
    if (method !== "POST") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const rev = db().query("SELECT * FROM revisions WHERE id = ? AND post_id = ?").get(revId, id) as
      | Revision
      | null;
    if (!rev) return notFound();
    snapshotPost(post, "restore"); // pre-revert state first — a revert is itself undoable
    db().run("UPDATE posts SET title = ?, content = ?, updated_at = ? WHERE id = ?", [
      rev.title ?? "",
      rev.content ?? "",
      now(),
      id,
    ]);
    return json(getPost(id));
  }
```

- [ ] **Step 4: Extend the 404-every-route test** — in `src/server.test.ts` at line 150 (`unknown id returns 404 {error: 'not found'} on every route`), add these two entries to the `routes` array, right after `post(`/posts/${missing}/revisions/1/restore`)`:

```ts
    api(`/posts/${missing}/revisions/1/compare/2`),
    post(`/posts/${missing}/revisions/1/revert`),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/server.test.ts -t "revert restores content"` and `bun test src/server.test.ts -t "unknown id returns 404"`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: add revert alias for revision restore"
```

---

### Task 4: Definition-of-done gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite**

Run: `bun test`
Expected: all tests PASS (existing + new; nothing else changes).

- [ ] **Step 2: Run the typecheck**

Run: `bun x tsc --noEmit`
Expected: exits 0, no output (or no errors).

- [ ] **Step 3: Manual smoke check (optional but quick)**

Run the server, then:
- `curl -s localhost:4501/api/posts` → create a post
- edit it via `PUT` twice
- `curl -s localhost:4501/api/posts/1/revisions` → rows have `title`, `summary`, `word_count`, `reason`
- `curl -s localhost:4501/api/posts/1/revisions/<a>/compare/<b>` → `{diff, added, removed, word_delta}`
- `curl -s -X POST localhost:4501/api/posts/1/revisions/<rev>/revert` → post restored, one more revision
Expected: sensible JSON everywhere; 404 for unknown ids; 400 for cross-post compare.

- [ ] **Step 4: Verify working tree is clean (nothing uncommitted beyond this plan's scope)**

Run: `git status --short`
Expected: no modified `src/` files (all committed in Tasks 1-3).

## Self-review notes (planner's checklist)

- **Spec coverage:** snapshot-on-edit (exists), first edit yields one revision (exists), schema (exists — see Decisions 1), list shape with title/summary (Task 1), single snapshot (exists), compare with per-line diff + counts + word delta + 400/404 semantics (Task 2), revert (Task 3), immutability (no revision update/delete routes added), word-count rule (existing `wordCount`), no UI changes (out of scope), `bun test` + `bun x tsc --noEmit` green (Task 4).
- **Placeholder scan:** every code step above contains exact code; no TBD/TODO.
- **Type consistency:** `lineDiff` returns `{op: "+"|"-"|" "; text: string}[]` — compare's `diff` is that array; `added`/`removed` are counts of `+`/`-`; `word_delta` is a number. `Revision` type already exists in `src/server.ts`. List rows use `title: string` (null-coalesced) and `summary: string`.
