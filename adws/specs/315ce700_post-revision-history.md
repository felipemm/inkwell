# Post Revision History: Versioned Edits with Diff and Revert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Inkwell's revision history to the contract in `adws/prompts/11-post-revision-history--versioned-edits-w.md`: every title/content edit snapshots the prior state into a new `post_revisions` table, and list/detail/compare/revert endpoints expose it so nothing a writer writes is ever lost.

**Architecture:** Additive second table. All new snapshots go to `post_revisions` (no `reason` column, no coalescing, no prune cap). The legacy `revisions` table is preserved untouched and simply stops being written to. The shared list/detail paths serve the new contract; the legacy `/diff` and `/restore` endpoints are kept and repointed at `post_revisions` so the shipped UI keeps working; `/revert` is the new canonical name with `/restore` as an alias.

**Tech Stack:** Bun, `bun:sqlite`, vanilla TypeScript/JS. No new dependencies. Diff reuses the existing exported deterministic `lineDiff` — no new dependency.

**Spec:** The prompt file `adws/prompts/11-post-revision-history--versioned-edits-w.md` is **missing from this working tree** (this session's branch `sssf/315ce700` was cut from `main` before that file was committed on sibling branch `sssf/eeefbd85`). Its exact content is recoverable with:
`git show sssf/eeefbd85:adws/prompts/11-post-revision-history--versioned-edits-w.md`
The full contract is embedded below in "Prompt Contract (verbatim from the prompt file)" so the builder never needs the file. An earlier run of the same prompt planned this work at `adws/specs/eeefbd85_post-revision-history.md` (on that branch); this plan is the current session's authoritative version.

## Prompt Contract (verbatim from the prompt file)

> Every edit to a post is versioned, so nothing a writer writes is ever lost.
>
> 1. **Revisions are snapshots.** Any update to a post's title or content saves the PREVIOUS state (title, content, updated_at) as a new revision row. Creating a post does not create a revision; editing it does. The first edit of a post yields one revision holding its original state.
> 2. **Schema.** A `post_revisions` table (id, post_id FK, title, content, created_at, word_count). Additive migration in the existing style — CREATE TABLE IF NOT EXISTS — no destructive changes. Preserve existing rows and endpoints.
> 3. **API.**
>    - `GET /posts/:id/revisions` → list of revisions for a post, newest first: id, created_at, title, word_count, summary (first ~80 chars of content). Empty list for a never-edited post. 404 for an unknown post.
>    - `GET /posts/:id/revisions/:revId` → the full snapshot (title + content + created_at + word_count). 404 for unknown post or revision.
>    - `GET /posts/:id/revisions/:a/compare/:b` → diff between two revisions: per-line added/removed (simple LCS or split-based diff is fine — no new dependency), plus added/removed line counts and word-count delta. 400 when a revision does not belong to the post; 404 when either side is unknown.
>    - `POST /posts/:id/revisions/:revId/revert` → restore the revision: current state becomes a revision (same rule as an edit) and the post's title/content are set from the snapshot. Returns the restored post. 404 for unknown post or revision.
> 4. **Consistency.** Revisions are immutable — no update/delete endpoints. Word counts count whitespace-separated words. All endpoints return the same JSON shape conventions as the existing routes (check src/server.ts for the established patterns: status codes, error bodies, helpers).
>
> Tests (bun test — the suite must stay green): edit creates a revision holding the prior state; first edit of a fresh post yields exactly one revision; list is newest-first with word_count and summary; compare returns added/removed lines and word deltas; cross-post compare is 400; revert restores content AND creates a new revision of the pre-revert state; unknown post/revision → 404; typecheck passes (bun x tsc --noEmit).
>
> Out of scope: No UI/editor changes, no tags interaction, no auth, no pagination (lists are small).
>
> Definition of done: All endpoints above exist, tests pass, `bun test` and `bun x tsc --noEmit` are green, and the code follows src/server.ts's existing conventions.

## Global Constraints

- **New table, new write path.** All new snapshots go to `post_revisions` (no `reason` column, no coalescing, no cap). The legacy `revisions` table is never dropped, never written to again, and its existing rows are never deleted by any migration. The only place legacy rows are deleted is the existing post-DELETE cascade, which is kept.
- **Shared paths follow the new spec.** `GET /api/posts/:id/revisions` and `GET /api/posts/:id/revisions/:revId` serve the new contract from `post_revisions`.
- **Legacy endpoints preserved, repointed.** The old `GET /api/posts/:id/revisions/:rev/diff` and `POST /api/posts/:id/revisions/:rev/restore` paths keep working — they now read/write `post_revisions`. `/revert` is the new canonical name; `/restore` is a kept alias with identical behavior. `/diff` keeps its legacy response shape (a bare array of `{op, text}`) because the shipped UI's `selectRevision()` consumes that shape.
- **Behavior changes baked in by the new spec:** snapshots happen only when a PUT actually changes title or content; the publish toggle no longer snapshots; there is no coalescing and no prune cap; revisions have no `reason`.
- **Do not touch anything under `src/public/`.** A known cosmetic consequence (accepted, out of scope): the UI's history list calls `revisionReasonText(rev.reason)`; new revisions have no `reason`, so the reason label renders empty.
- The builder never commits — the factory owns commits. The builder's envelope must list every changed file (`src/server.ts`, `src/server.test.ts`).
- Verification gates: `bun test`, `bun x tsc --noEmit`, `bun build src/server.ts --outdir /tmp/inkwell-build --target bun` must all be green.

---

## Current code map (src/server.ts — verified at HEAD 6d5a178)

- `db()` — creates `posts`, `revisions`, `posts_fts`; the `revisions` DDL is right after the two `ALTER TABLE posts` try/catches (lines ~65-74).
- `type Post`, `type Revision`, `const COALESCE_MS = 60_000` (line 21), `const MAX_REVISIONS_PER_POST = 50` (line 22).
- `wordCount`, `now`, `getPost`, `snapshotPost(post, reason)` (line ~138, coalesce + prune), `splitLines`, exported `lineDiff` (line ~170).
- Routes in `handleApi`: `publish` (len 4, line ~529), `schedule` (len 4), `stats` (len 4), `revisions` list (len 4, line ~585), `revisions/:rev` (len 5, line ~595), `revisions/:rev/diff` (len 6, line ~607), `revisions/:rev/restore` (len 6, line ~621), post CRUD (len 3, line ~646).
- Conventions: `json(body, status)` helper, `notFound()` = `{error: "not found"}` 404, method guard = `json({ error: "method not allowed" }, 405)`, `Number.isInteger` check on id segments → `notFound()`.

---

### Task 1: server.ts — schema, helpers, write paths

**Files:**
- Modify: `src/server.ts` (db() schema, types/constants, `snapshotPost` → `snapshotRevision`, PUT/publish/DELETE handlers)
- Test: `src/server.test.ts` (updated in Task 3)

**Interfaces:**
- Consumes: existing `db()`, `wordCount`, `now`, `getPost`, `lineDiff`.
- Produces: `type PostRevision`, `function snapshotRevision(post: Post): void`, the `post_revisions` table + index. Task 2's routes and Task 3's `postRevisionsOf` helper rely on these names and shapes.

- [ ] **Step 1: Add the `post_revisions` schema in `db()`**

Immediately after the existing `revisions` table creation and its index (after line ~74), add:

```ts
  _db.run(`CREATE TABLE IF NOT EXISTS post_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    created_at TEXT,
    word_count INTEGER DEFAULT 0
  )`);
  _db.run("CREATE INDEX IF NOT EXISTS idx_post_revisions_post ON post_revisions(post_id, id DESC)");
```

Leave the legacy `revisions` CREATE TABLE / CREATE INDEX untouched — preserving existing rows and the legacy schema.

- [ ] **Step 2: Replace `type Revision` with `type PostRevision` and delete the constants**

Replace `type Revision` with:

```ts
type PostRevision = {
  id: number;
  post_id: number;
  title: string | null;
  content: string | null;
  created_at: string;
  word_count: number;
};
```

Delete `const COALESCE_MS = 60_000;` and `const MAX_REVISIONS_PER_POST = 50;` (both become unused — no coalescing, no cap).

- [ ] **Step 3: Replace `snapshotPost` with `snapshotRevision`**

Delete `snapshotPost(post, reason)` entirely (lines ~138-165). Add in its place:

```ts
/** Snapshots a post's pre-edit state into post_revisions. Every title/content
 *  edit appends one immutable revision — no coalescing, no pruning cap, so
 *  nothing a writer writes is ever lost. Creating a post does not snapshot. */
function snapshotRevision(post: Post): void {
  db().run(
    "INSERT INTO post_revisions (post_id, title, content, created_at, word_count) VALUES (?, ?, ?, ?, ?)",
    [post.id, post.title ?? "", post.content ?? "", now(), wordCount(post.content ?? "")],
  );
}
```

Notes: `created_at` = `now()` at snapshot time (the moment the prior state was superseded), matching the legacy table's timestamp convention. `word_count` is computed from the snapshot's content (the PRE-edit content).

- [ ] **Step 4: Repoint the PUT write path**

In the `segments.length === 3` POST-CRUD block (`PUT`), change:

```ts
      if (title !== post.title || content !== post.content) {
        snapshotPost(post, "edit");
      }
```

to:

```ts
      if (title !== post.title || content !== post.content) {
        snapshotRevision(post);
      }
```

The existing trigger is preserved exactly: a PUT that changes nothing, or only `target_word_count`, adds no revision; creation adds no revision.

- [ ] **Step 5: Remove the publish-toggle snapshot**

In the `POST /api/posts/:id/publish` handler (len 4, line ~534), **delete** the line:

```ts
    snapshotPost(post, post.status === "published" ? "unpublish" : "publish");
```

The publish toggle changes status only, not title/content, so it must not create a revision.

- [ ] **Step 6: Add the post_revisions cascade to DELETE**

In the `DELETE` branch of the `segments.length === 3` block, add the post_revisions delete before deleting the post (keep the legacy `revisions` delete line):

```ts
    if (method === "DELETE") {
      db().run("DELETE FROM revisions WHERE post_id = ?", [id]);
      db().run("DELETE FROM post_revisions WHERE post_id = ?", [id]);
      db().run("DELETE FROM posts WHERE id = ?", [id]);
      return json({ ok: true });
    }
```

- [ ] **Step 7: Verify no stale identifiers remain**

Run: `grep -n "snapshotPost\|COALESCE_MS\|MAX_REVISIONS_PER_POST" src/server.ts`
Expected: no matches. Run `bun x tsc --noEmit` — the `Revision` type is gone, so every use must already be updated (the route handlers still reference `Revision` at this point — they are fixed in Task 2; if typecheck fails here only on the route blocks, that is expected and resolved by Task 2).

---

### Task 2: server.ts — routes

**Files:**
- Modify: `src/server.ts` (`handleApi` revision routes)

**Interfaces:**
- Consumes: `type PostRevision`, `snapshotRevision(post)`, existing `lineDiff`, `wordCount`, `getPost`, `notFound`, `json`.
- Produces: the four API contract endpoints plus the two preserved legacy endpoints. Task 3's tests call these routes.

All new/changed routes go in `handleApi` where the current revision routes live (after the `stats` block, before the `segments.length === 3` post CRUD block). Segment counts are all distinct (4, 5, 6, 6, 7), so order between them does not matter; keep them grouped.

- [ ] **Step 1: `GET /api/posts/:id/revisions` — list (len 4) — REPLACE the existing list handler**

```ts
  // /api/posts/:id/revisions
  if (segments.length === 4 && segments[3] === "revisions") {
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    if (!getPost(id)) return notFound();
    const rows = db()
      .query("SELECT id, title, content, created_at, word_count FROM post_revisions WHERE post_id = ? ORDER BY id DESC")
      .all(id) as { id: number; title: string | null; content: string | null; created_at: string; word_count: number }[];
    return json(rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      title: r.title,
      word_count: r.word_count,
      summary: (r.content ?? "").slice(0, 80),
    })));
  }
```

Newest first (ORDER BY id DESC), empty array for a never-edited post, 404 for an unknown post.

- [ ] **Step 2: `GET /api/posts/:id/revisions/:revId` — detail (len 5) — REPLACE the existing detail handler**

```ts
  // /api/posts/:id/revisions/:revId
  if (segments.length === 5 && segments[3] === "revisions") {
    const revId = Number(segments[4]);
    if (!Number.isInteger(revId)) return notFound();
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    if (!getPost(id)) return notFound();
    const rev = db().query("SELECT * FROM post_revisions WHERE id = ? AND post_id = ?").get(revId, id) as
      | PostRevision
      | null;
    if (!rev) return notFound();
    return json(rev);
  }
```

Full snapshot row: id, post_id, title, content, created_at, word_count. 404 for unknown post or revision (including a revision that belongs to a different post).

- [ ] **Step 3: `GET /api/posts/:id/revisions/:a/compare/:b` — NEW (len 7)**

```ts
  // /api/posts/:id/revisions/:a/compare/:b
  if (segments.length === 7 && segments[3] === "revisions" && segments[5] === "compare") {
    const a = Number(segments[4]);
    const b = Number(segments[6]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return notFound();
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    if (!getPost(id)) return notFound();
    const revA = db().query("SELECT * FROM post_revisions WHERE id = ?").get(a) as PostRevision | null;
    if (!revA) return notFound(); // unknown revision → 404
    if (revA.post_id !== id) return json({ error: "revision does not belong to this post" }, 400);
    const revB = db().query("SELECT * FROM post_revisions WHERE id = ?").get(b) as PostRevision | null;
    if (!revB) return notFound(); // unknown revision → 404
    if (revB.post_id !== id) return json({ error: "revision does not belong to this post" }, 400);
    const lines = lineDiff(revA.content ?? "", revB.content ?? "");
    return json({
      lines,
      added: lines.filter((l) => l.op === "+").length,
      removed: lines.filter((l) => l.op === "-").length,
      word_delta: wordCount(revB.content ?? "") - wordCount(revA.content ?? ""),
    });
  }
```

Semantics: `/compare/:a/:b` diffs revision a (base) → revision b (target); `word_delta = wordCount(b) - wordCount(a)`. Reuses the existing exported deterministic `lineDiff` — no new dependency. **400** when a revision exists but belongs to a different post; **404** when either side is unknown (or the post is unknown, or a segment is not an integer).

- [ ] **Step 4: `POST /api/posts/:id/revisions/:revId/revert` — NEW (len 6, `revert`)**

```ts
  // /api/posts/:id/revisions/:revId/revert
  if (segments.length === 6 && segments[3] === "revisions" && segments[5] === "revert") {
    const revId = Number(segments[4]);
    if (!Number.isInteger(revId)) return notFound();
    if (method !== "POST") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const rev = db().query("SELECT * FROM post_revisions WHERE id = ? AND post_id = ?").get(revId, id) as
      | PostRevision
      | null;
    if (!rev) return notFound();
    snapshotRevision(post); // current state becomes a revision — same rule as an edit
    db().run("UPDATE posts SET title = ?, content = ?, updated_at = ? WHERE id = ?", [
      rev.title ?? "",
      rev.content ?? "",
      now(),
      id,
    ]);
    return json(getPost(id));
  }
```

404 for unknown post or revision. Returns the restored post. The pre-revert snapshot makes the revert itself undoable.

- [ ] **Step 5: Legacy endpoints, preserved and repointed**

1. **`GET /api/posts/:id/revisions/:rev/diff`** (len 6, `diff`) — keep the route, change ONLY the table in its revision query from `revisions` to `post_revisions`:

   ```ts
   const rev = db()
     .query("SELECT content FROM post_revisions WHERE id = ? AND post_id = ?")
     .get(revId, id) as { content: string | null } | null;
   ```

   Response stays a bare array of `{op, text}` (the shipped UI depends on this shape).

2. **`POST /api/posts/:id/revisions/:rev/restore`** (len 6, `restore`) — keep the route as an alias for revert: change the revision query to `post_revisions`, and replace `snapshotPost(post, "restore")` with `snapshotRevision(post)`. Everything else (404s, UPDATE, `json(getPost(id))`) is unchanged.

- [ ] **Step 6: Typecheck the whole file**

Run: `bun x tsc --noEmit`
Expected: PASS. No unused `COALESCE_MS`/`MAX_REVISIONS_PER_POST`/`Revision` leftovers; the new `PostRevision` type is used by every route.

---

### Task 3: server.test.ts — update old-contract tests, add the new ones

**Files:**
- Modify: `src/server.test.ts`

**Interfaces:**
- Consumes: the four API endpoints from Task 2, the `post_revisions` table from Task 1.
- Produces: a green suite covering every numbered prompt item.

The suite must end green. The revision-section tests below assert the OLD contract and must be updated; everything else in the file is untouched. Fate of every test in the `Revision history` section (starts line ~1143):

| Existing test | Fate |
|---|---|
| `migrates a pre-revisions database in place and leaves existing posts intact` | UPDATE — also assert `post_revisions` exists with the new columns |
| `PUT snapshots the pre-edit row, and only when title or content actually changed` | UPDATE — read `post_revisions`; drop `reason` assertions |
| `autosave coalescing: edit revisions younger than 60s are overwritten, not appended` | REPLACE — each edit appends; nothing coalesced |
| `publish toggle snapshots with reason publish/unpublish, never coalescing` | REPLACE — publish adds no revision |
| `at most 50 revisions per post — oldest pruned; deleting a post deletes its revisions` | REPLACE — no pruning; delete cascades both tables |
| `GET /api/posts/:id/revisions returns newest-first {id, created_at, word_count, reason}` | REPLACE — new shape `{id, created_at, title, word_count, summary}` |
| `GET /api/posts/:id/revisions/:rev returns the full snapshot, 404 for other posts` | UPDATE — new shape (no `reason`) |
| `lineDiff is a deterministic, hand-written line diff over {op, text}` | KEEP unchanged |
| `GET /api/posts/:id/revisions/:rev/diff diffs the snapshot against current content` | UPDATE — drop the publish-snapshot half |
| `restore snapshots the pre-restore state first, applies the revision, and is undoable` | REPLACE — new revert test (+ `/restore` alias smoke) |
| four UI tests (history panel, app.js wiring, pure diff section, style.css) | KEEP unchanged |
| `unknown id returns 404 {error: 'not found'} on every route` | UPDATE — add `/revisions/1/compare/2` and `/revisions/1/revert` to the sweep |
| **NEW** `GET /api/posts/:id/revisions/:a/compare/:b` test | ADD |

- [ ] **Step 1: Replace the `revisionsOf` helper**

Replace the `revisionsOf` helper (line ~47) with one that reads the new table:

```ts
/** Reads post_revision rows straight from sqlite. */
const postRevisionsOf = (postId: number) => {
  const db = new Database(process.env.INKWELL_DB!);
  try {
    return db.query("SELECT * FROM post_revisions WHERE post_id = ? ORDER BY id").all(postId) as any[];
  } finally {
    db.close();
  }
};
```

- [ ] **Step 2: Migration test — UPDATE**

Keep the existing test body, but after the legacy `revisions` PRAGMA assertion add:

```ts
    const prCols = (check.query("PRAGMA table_info(post_revisions)").all() as any[]).map((c) => c.name);
    expect(prCols).toEqual(["id", "post_id", "title", "content", "created_at", "word_count"]);
```

Rename the test to reflect both tables, e.g. `"migrates a pre-revisions database in place: legacy revisions preserved, post_revisions created"`.

- [ ] **Step 3: PUT snapshot test — UPDATE**

Keep the structure, swap `revisionsOf` → `postRevisionsOf`, and drop `reason` assertions:

- creation adds no revision: `expect(postRevisionsOf(created.id).length).toBe(0)`
- after `put({content: "two"})`: 1 row, `rows[0].content === "one"` (pre-edit snapshot), `rows[0].word_count === 1`, `rows[0].post_id === created.id`, and `expect(rows[0]).not.toHaveProperty("reason")`
- no-op PUT → still 1 row
- `target_word_count`-only PUT → still 1 row
- This also proves the prompt's "first edit of a fresh post yields exactly one revision".

- [ ] **Step 4: No-coalescing test — REPLACE the coalescing test**

```ts
test("every title/content edit appends its own revision — nothing is coalesced or lost", async () => {
  const created = await (await post("/posts", { title: "C", content: "v1" })).json();
  await put(`/posts/${created.id}`, { content: "v2" });
  await put(`/posts/${created.id}`, { content: "v3" });
  await put(`/posts/${created.id}`, { content: "v4" });

  const rows = postRevisionsOf(created.id);
  expect(rows.length).toBe(3); // three saves, three revisions
  expect(rows.map((r) => r.content)).toEqual(["v1", "v2", "v3"]); // pre-edit states, in order
  expect(rows.every((r) => r.post_id === created.id)).toBe(true);
});
```

- [ ] **Step 5: Publish-toggle test — REPLACE**

```ts
test("publish toggle does not create a revision", async () => {
  const created = await (await post("/posts", { title: "P", content: "body" })).json();
  await put(`/posts/${created.id}`, { content: "edited" });
  await post(`/posts/${created.id}/publish`);
  await post(`/posts/${created.id}/publish`);

  const rows = postRevisionsOf(created.id);
  expect(rows.length).toBe(1); // only the PUT's pre-edit snapshot
  expect(rows[0].content).toBe("body");
});
```

- [ ] **Step 6: No-pruning / delete-cascade test — REPLACE**

```ts
test("revisions are never pruned; deleting a post deletes its revisions", async () => {
  const created = await (await post("/posts", { title: "Cap", content: "seed" })).json();

  // seed 55 revisions directly (bypasses the API)
  const db = new Database(process.env.INKWELL_DB!);
  const ins = db.prepare(
    "INSERT INTO post_revisions (post_id, title, content, created_at, word_count) VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z', 1)",
  );
  for (let i = 0; i < 55; i++) ins.run(created.id, "Cap", `old-${i}`);
  db.close();

  await put(`/posts/${created.id}`, { content: "fresh" });
  let rows = postRevisionsOf(created.id);
  expect(rows.length).toBe(56); // no prune — every snapshot survives
  expect(rows[rows.length - 1].content).toBe("seed"); // newest = the PUT's pre-edit snapshot

  await api(`/posts/${created.id}`, { method: "DELETE" });
  rows = postRevisionsOf(created.id);
  expect(rows.length).toBe(0); // cascade
});
```

- [ ] **Step 7: List test — REPLACE with the new-shape test**

```ts
test("GET /api/posts/:id/revisions returns newest-first {id, created_at, title, word_count, summary}", async () => {
  const created = await (await post("/posts", { title: "L", content: "one" })).json();
  await put(`/posts/${created.id}`, { content: "two" });
  await put(`/posts/${created.id}`, { content: "three" });

  const res = await api(`/posts/${created.id}/revisions`);
  expect(res.status).toBe(200);
  const list = await res.json();
  expect(list.length).toBe(2);
  expect(Object.keys(list[0]).sort()).toEqual(["created_at", "id", "summary", "title", "word_count"]);
  expect(list[0].id).toBeGreaterThan(list[1].id); // newest first
  expect(list[0].title).toBe("L");
  expect(list[0].word_count).toBe(1); // pre-edit content "two" → one word
  expect(list[0].summary).toBe("one"); // first ~80 chars of the snapshot content
  expect(typeof list[0].created_at).toBe("string");
  expect(list[0]).not.toHaveProperty("content"); // summary, not content

  // long content → summary truncates at 80 chars
  const long = await (await post("/posts", { title: "Long", content: "x".repeat(200) })).json();
  await put(`/posts/${long.id}`, { content: "y" });
  const longList = await (await api(`/posts/${long.id}/revisions`)).json();
  expect(longList[0].summary.length).toBe(80);
  expect(longList[0].summary).toBe("x".repeat(80));

  // never-edited post → empty list; unknown post → 404
  const fresh = await (await post("/posts", { title: "Fresh" })).json();
  expect(await (await api(`/posts/${fresh.id}/revisions`)).json()).toEqual([]);
  const missing = await api("/posts/999999/revisions");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });
});
```

- [ ] **Step 8: Detail test — UPDATE**

Keep the structure, but the full snapshot now has no `reason`. Assertions become: `rev.id`, `rev.post_id`, `rev.title === "A"`, `rev.content === "alpha one"`, `rev.word_count === 2`, `typeof rev.created_at === "string"`, `expect(rev).not.toHaveProperty("reason")`. Cross-post → 404, unknown rev → 404, non-integer → 404 all unchanged.

- [ ] **Step 9: `lineDiff` test — KEEP unchanged.**

- [ ] **Step 10: `/diff` test — UPDATE**

Delete the "identical snapshot vs current" half that relies on the publish snapshot (publish no longer snapshots). Keep the core: edit → diff against current content returns the expected `[{op:" ",...}, {op:"-",...}, ...]` array, and cross-post diff → 404.

- [ ] **Step 11: Revert test — REPLACE the restore test**

```ts
test("revert restores content AND creates a new revision of the pre-revert state", async () => {
  const created = await (await post("/posts", { title: "R", content: "one" })).json();
  await put(`/posts/${created.id}`, { content: "two" });
  await put(`/posts/${created.id}`, { content: "three" });

  const list = await (await api(`/posts/${created.id}/revisions`)).json();
  const revTwo = await (await api(`/posts/${created.id}/revisions/${list[0].id}`)).json();
  expect(revTwo.content).toBe("two"); // newest revision holds the pre-edit state of the last PUT

  await Bun.sleep(5);
  const before = await (await api(`/posts/${created.id}`)).json();

  const res = await post(`/posts/${created.id}/revisions/${revTwo.id}/revert`);
  expect(res.status).toBe(200);
  const restored = await res.json();
  expect(restored.title).toBe("R");
  expect(restored.content).toBe("two");
  expect(restored.updated_at > before.updated_at).toBe(true);

  // the pre-revert state ("three") was snapshotted first
  const after = await (await api(`/posts/${created.id}/revisions`)).json();
  expect(after.length).toBe(3);
  expect(after[0].title).toBe("R");
  const revertSnap = await (await api(`/posts/${created.id}/revisions/${after[0].id}`)).json();
  expect(revertSnap.content).toBe("three");

  // so a revert is itself undoable
  const undo = await (await post(`/posts/${created.id}/revisions/${after[0].id}/revert`)).json();
  expect(undo.content).toBe("three");

  // the legacy /restore alias keeps working
  const restoredAgain = await (await post(`/posts/${created.id}/revisions/${after[0].id}/restore`)).json();
  expect(restoredAgain.content).toBe("three");

  // unknown post / unknown revision / other post's revision → 404
  expect((await post(`/posts/999999/revisions/${revTwo.id}/revert`)).status).toBe(404);
  expect((await post(`/posts/${created.id}/revisions/999999/revert`)).status).toBe(404);
  const other = await (await post("/posts", { title: "O", content: "x" })).json();
  expect((await post(`/posts/${other.id}/revisions/${revTwo.id}/revert`)).status).toBe(404);
});
```

- [ ] **Step 12: Compare test — ADD**

```ts
test("GET /api/posts/:id/revisions/:a/compare/:b returns lines, counts, and word delta", async () => {
  const created = await (await post("/posts", { title: "Cmp", content: "one\ntwo\nthree" })).json();
  await put(`/posts/${created.id}`, { content: "one\ntwo\nthree\nfour" });
  await put(`/posts/${created.id}`, { content: "one\ntwo\nTHREE\nfour\nfive" });

  const list = await (await api(`/posts/${created.id}/revisions`)).json();
  const [rev2, rev1] = list; // newest first: rev2 = "one\ntwo\nTHREE\nfour\nfive", rev1 = "one\ntwo\nthree\nfour"

  const res = await api(`/posts/${created.id}/revisions/${rev1.id}/compare/${rev2.id}`);
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.lines).toEqual([
    { op: " ", text: "one" },
    { op: " ", text: "two" },
    { op: "-", text: "three" },
    { op: "+", text: "THREE" },
    { op: " ", text: "four" },
    { op: "+", text: "five" },
  ]);
  expect(data.added).toBe(2);
  expect(data.removed).toBe(1);
  expect(data.word_delta).toBe(1); // wordCount(b) - wordCount(a)

  // reverse direction flips the deltas
  const rev = await (await api(`/posts/${created.id}/revisions/${rev2.id}/compare/${rev1.id}`)).json();
  expect(rev.added).toBe(1);
  expect(rev.removed).toBe(2);
  expect(rev.word_delta).toBe(-1);

  // unknown revision on either side → 404
  expect((await api(`/posts/${created.id}/revisions/${rev1.id}/compare/999999`)).status).toBe(404);
  expect((await api(`/posts/${created.id}/revisions/999999/compare/${rev2.id}`)).status).toBe(404);
  expect((await api(`/posts/999999/revisions/${rev1.id}/compare/${rev2.id}`)).status).toBe(404);

  // revision that belongs to a different post → 400
  const other = await (await post("/posts", { title: "Other", content: "x" })).json();
  await put(`/posts/${other.id}`, { content: "y" });
  const otherRev = (await (await api(`/posts/${other.id}/revisions`)).json())[0];
  const cross = await api(`/posts/${created.id}/revisions/${otherRev.id}/compare/${rev2.id}`);
  expect(cross.status).toBe(400);
  expect((await cross.json()).error).toBeTruthy();
});
```

- [ ] **Step 13: 404 sweep — UPDATE**

Add these two entries to the `routes` array in `unknown id returns 404 {error: 'not found'} on every route` (line ~150):

```ts
    api(`/posts/${missing}/revisions/1/compare/2`),
    post(`/posts/${missing}/revisions/1/revert`),
```

- [ ] **Step 14: Run the suite**

Run: `bun test`
Expected: PASS — the entire suite green (updated revision tests + all existing tests untouched).

---

### Task 4: Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: PASS (no unused `COALESCE_MS`/`MAX_REVISIONS_PER_POST`/`Revision` leftovers; new `PostRevision` used by every route).

- [ ] **Step 3: Build**

Run: `bun build src/server.ts --outdir /tmp/inkwell-build --target bun`
Expected: PASS.

- [ ] **Step 4: Grep sanity**

Run: `grep -n "revisions" src/server.ts`
Expected: `post_revisions` appears on all write/read paths; `snapshotPost`, `COALESCE_MS`, `MAX_REVISIONS_PER_POST`, and the `Revision` type are gone.

---

## Definition of done

- `post_revisions` table + index created additively in `db()`; legacy `revisions` table, its rows, and the legacy `/diff` + `/restore` endpoints survive.
- `GET /api/posts/:id/revisions` (new shape with summary, newest first, empty for never-edited, 404 unknown post), `GET /api/posts/:id/revisions/:revId` (full snapshot, 404s), `GET /api/posts/:id/revisions/:a/compare/:b` (lines + added/removed + word_delta; 400 cross-post; 404 unknown), `POST /api/posts/:id/revisions/:revId/revert` (pre-revert snapshot + apply + returns post; 404s) all work.
- PUT title/content edits snapshot the prior state; creation, no-op PUTs, `target_word_count`-only PUTs, and publish toggles do not.
- No coalescing, no prune cap, no update/delete revision endpoints.
- `bun test`, `bun x tsc --noEmit`, and the build gate are green; `src/public/` untouched.
