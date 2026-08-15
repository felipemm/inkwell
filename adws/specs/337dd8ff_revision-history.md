# Revision History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Inkwell a revision history — every meaningful save snapshots the post's prior state, the writer can browse those snapshots, diff any one against the current text, and restore it.

**Architecture:** `db()` creates a `revisions` table (id, post_id, title, content, word_count, reason, created_at) plus a `(post_id, id DESC)` index via `CREATE TABLE/INDEX IF NOT EXISTS` — an in-place migration that leaves existing `posts` rows untouched. A single helper `snapshotPost(post, reason)` writes a snapshot of a pre-edit `Post` row; for reason `'edit'` it coalesces: if the post's newest revision is an `'edit'` younger than 60 s, that revision is overwritten (created_at bumped) instead of appending. Every insert prunes to the newest 50 revisions per post. Write paths call it: `PUT /api/posts/:id` (only when title or content actually changed), the publish toggle (`'publish'`/`'unpublish'`), and restore (`'restore'`, pre-restore state first). Read routes: `GET /api/posts/:id/revisions` (newest-first summaries), `GET /api/posts/:id/revisions/:rev` (full snapshot, 404 if it belongs to another post), `GET /api/posts/:id/revisions/:rev/diff` (hand-written, deterministic LCS line diff of the snapshot against current content, exported as a pure function for direct tests), `POST /api/posts/:id/revisions/:rev/restore`. The client gets a `history` button in the editor footer opening a modal: revision list (relative time, word count, reason), a line diff view (added/removed lines visually distinct), and a restore button that applies the revision and refreshes the editor in place. The diff renderer is a pure `// --- history (pure) ---` section in app.js, testable via the existing `loadSection` pattern.

**Tech Stack:** Bun (bun:sqlite), vanilla JS/CSS client. No new dependencies, no `package.json` edits.

**Spec:** `adws/prompts/02-revision-history.md`

**Path note:** the app lives under `src/` (`src/server.ts`, `src/server.test.ts`, `src/public/index.html`, `src/public/app.js`, `src/public/style.css`), not `apps/inkwell/`. Tests run with `bun test src/server.test.ts` (package.json `"test": "bun test"`).

## Global Constraints

- **Bun + bun:sqlite only.** No new dependencies, no `package.json` edits, vanilla JS on the client.
- **Migrate in place.** `CREATE TABLE IF NOT EXISTS revisions (…)` + `CREATE INDEX IF NOT EXISTS …` inside `db()`; an existing `inkwell.db` keeps working and its posts stay intact.
- **`PUT /api/posts/:id` snapshots the PRE-EDIT row, and only when title or content actually changed.** A PUT that changes nothing, or only `target_word_count`, adds no revision. `POST /api/posts` (creation) adds no revision — there is no prior state.
- **Coalescing rule:** if the post's newest revision has `reason = 'edit'` AND is younger than 60 s (`Date.now() - Date.parse(rev.created_at) < 60_000`), overwrite that revision instead of inserting, and bump its `created_at` to the snapshot time (sliding window: continuous typing stays one revision). Publish/unpublish/restore snapshots never coalesce — they always append.
- **At most 50 revisions per post** — after every insert, prune the oldest (`DELETE … WHERE id NOT IN (SELECT id … ORDER BY id DESC LIMIT 50)`). Deleting a post deletes its revisions.
- **Deterministic line diff.** `lineDiff` is hand-written (LCS over lines), exported from `src/server.ts`, and must produce the exact same array for the same inputs every run. `splitLines("") === []`.
- **Do not change the `GET /api/posts` summary shape.** The existing exact-key assertion (`["id","status","title","updated_at","word_count","target_word_count"]`) must pass untouched.
- **`bun test src/server.test.ts` stays green** and gains tests for every numbered "Done means" item (1–10).
- **The builder never commits.** The factory owns every commit; the plan's steps end at running the tests. `commit_message` in the final envelope is the subject the factory uses.
- **Out of scope:** word/character-level inline diffs, three-way merge, branching/named versions, per-revision authorship/comments, textarea-level undo/redo, changing the autosave debounce, diffing two arbitrary revisions against each other, new shortcuts.

---

### Task 1: Revisions schema, snapshot/coalesce/prune helpers, write-path snapshots

**Files:**
- Modify: `src/server.ts` — `db()` migration, new module-level helpers/types, `PUT /api/posts/:id`, `POST /api/posts/:id/publish`, `DELETE /api/posts/:id`
- Test: `src/server.test.ts` — tests for items 1, 2, 3, 4, 9

**Interfaces:**
- Consumes: existing `Post` type, `wordCount()`, `now()`, `db()`, `getPost()`
- Produces: the `revisions` table + index (created on every `db()` open); `snapshotPost(post: Post, reason: string): void`; constants `COALESCE_MS = 60_000` and `MAX_REVISIONS_PER_POST = 50`. Tasks 2–4 consume `snapshotPost` and the table.

- [ ] **Step 1: Add a top-level Database import to the test file**

In `src/server.test.ts`, add `import { Database } from "bun:sqlite";` next to the existing `bun:test` import (the server itself imports it the same way). Add two small helpers after the existing `post` helper:

```ts
const put = (path: string, body?: unknown) =>
  api(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Reads revision rows straight from sqlite — used until the read routes land in Task 2. */
const revisionsOf = (postId: number) => {
  const db = new Database(process.env.INKWELL_DB!);
  try {
    return db.query("SELECT * FROM revisions WHERE post_id = ? ORDER BY id").all(postId) as any[];
  } finally {
    db.close();
  }
};
```

- [ ] **Step 2: Write the failing tests for items 1–4 and 9**

Append to `src/server.test.ts`:

```ts
test("migrates a pre-revisions database in place and leaves existing posts intact", async () => {
  const dbPath = join(tmpdir(), `inkwell-revisions-migrate-${Date.now()}-${process.pid}.db`);
  const raw = new Database(dbPath, { create: true });
  raw.run(`CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT,
    status TEXT DEFAULT 'draft', target_word_count INTEGER DEFAULT 0,
    created_at TEXT, updated_at TEXT
  )`);
  raw.run("INSERT INTO posts (title, content, status, created_at, updated_at) VALUES ('Legacy', 'still here', 'draft', '2026-01-01', '2026-01-01')");
  raw.close();

  const prev = process.env.INKWELL_DB;
  process.env.INKWELL_DB = dbPath;
  closeDb(); // next request re-opens against the pre-revisions file and upgrades it
  try {
    const res = await api("/posts");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].title).toBe("Legacy");

    const check = new Database(dbPath);
    const cols = (check.query("PRAGMA table_info(revisions)").all() as any[]).map((c) => c.name);
    expect(cols).toEqual(["id", "post_id", "title", "content", "word_count", "reason", "created_at"]);
    check.close();
  } finally {
    closeDb();
    process.env.INKWELL_DB = prev;
    for (const suffix of ["", "-shm", "-wal"]) rmSync(dbPath + suffix, { force: true });
  }
});

test("PUT snapshots the pre-edit row, and only when title or content actually changed", async () => {
  const created = await (await post("/posts", { title: "T", content: "one" })).json();

  // creation itself adds no revision
  expect(revisionsOf(created.id).length).toBe(0);

  await put(`/posts/${created.id}`, { content: "two" });
  let rows = revisionsOf(created.id);
  expect(rows.length).toBe(1);
  expect(rows[0].reason).toBe("edit");
  expect(rows[0].content).toBe("one"); // pre-edit snapshot
  expect(rows[0].word_count).toBe(1);
  expect(rows[0].post_id).toBe(created.id);

  // a PUT that changes nothing adds no revision
  await put(`/posts/${created.id}`, { content: "two" });
  expect(revisionsOf(created.id).length).toBe(1);

  // a PUT that changes only target_word_count adds no revision
  await put(`/posts/${created.id}`, { target_word_count: 500 });
  expect(revisionsOf(created.id).length).toBe(1);
});

test("autosave coalescing: edit revisions younger than 60s are overwritten, not appended", async () => {
  const created = await (await post("/posts", { title: "C", content: "v1" })).json();
  await put(`/posts/${created.id}`, { content: "v2" });
  await put(`/posts/${created.id}`, { content: "v3" });
  await put(`/posts/${created.id}`, { content: "v4" });

  let rows = revisionsOf(created.id);
  expect(rows.length).toBe(1); // three saves, one revision
  expect(rows[0].content).toBe("v3"); // the newest pre-edit state won the overwrite
  expect(rows[0].reason).toBe("edit");

  // age the revision past the 60s window → the next save appends instead
  const db = new Database(process.env.INKWELL_DB!);
  db.run("UPDATE revisions SET created_at = '2020-01-01T00:00:00.000Z'");
  db.close();

  await put(`/posts/${created.id}`, { content: "v5" });
  rows = revisionsOf(created.id);
  expect(rows.length).toBe(2);
  expect(rows[1].reason).toBe("edit");
  expect(rows[1].content).toBe("v4");
});

test("publish toggle snapshots with reason publish/unpublish, never coalescing", async () => {
  const created = await (await post("/posts", { title: "P", content: "body" })).json();
  await put(`/posts/${created.id}`, { content: "edited" });
  await post(`/posts/${created.id}/publish`);
  await post(`/posts/${created.id}/publish`);

  const rows = revisionsOf(created.id);
  expect(rows.length).toBe(3); // edit, publish, unpublish — each its own revision
  expect(rows[0].reason).toBe("edit");
  expect(rows[1].reason).toBe("publish");
  expect(rows[1].content).toBe("edited"); // pre-toggle snapshot
  expect(rows[2].reason).toBe("unpublish");
});

test("at most 50 revisions per post — oldest pruned; deleting a post deletes its revisions", async () => {
  const created = await (await post("/posts", { title: "Cap", content: "seed" })).json();

  // seed 55 old edit revisions directly (bypasses the API)
  const db = new Database(process.env.INKWELL_DB!);
  const ins = db.prepare(
    "INSERT INTO revisions (post_id, title, content, word_count, reason, created_at) VALUES (?, ?, ?, ?, 'edit', '2020-01-01T00:00:00.000Z')",
  );
  for (let i = 0; i < 55; i++) ins.run(created.id, "Cap", `old-${i}`, 1);
  db.close();

  await put(`/posts/${created.id}`, { content: "fresh" }); // appends (newest is old) → 56 → prune
  let rows = revisionsOf(created.id);
  expect(rows.length).toBe(50);
  expect(rows[0].id).toBe(7); // six oldest seeded rows pruned
  expect(rows[rows.length - 1].content).toBe("seed"); // newest = the PUT's pre-edit snapshot

  await api(`/posts/${created.id}`, { method: "DELETE" });
  rows = revisionsOf(created.id);
  expect(rows.length).toBe(0); // cascade
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `bun test src/server.test.ts`
Expected: the five new tests FAIL (no `revisions` table yet), all existing tests PASS.

- [ ] **Step 4: Implement the schema, helpers, and write-path snapshots in `src/server.ts`**

1. In `db()`, immediately after the existing `ALTER TABLE posts ADD COLUMN target_word_count …` try/catch, add:

```ts
  _db.run(`CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    word_count INTEGER DEFAULT 0,
    reason TEXT,
    created_at TEXT
  )`);
  _db.run("CREATE INDEX IF NOT EXISTS idx_revisions_post ON revisions(post_id, id DESC)");
```

2. Add module-level constants and the `Revision` type near the top (after `type Post`):

```ts
const COALESCE_MS = 60_000;
const MAX_REVISIONS_PER_POST = 50;

type Revision = {
  id: number;
  post_id: number;
  title: string | null;
  content: string | null;
  word_count: number;
  reason: string;
  created_at: string;
};
```

3. Add `snapshotPost` right after the existing `getPost` helper:

```ts
/** Snapshots a post's pre-edit state. 'edit' snapshots coalesce: if the newest
 *  revision for this post is an 'edit' younger than 60s, it is overwritten
 *  (created_at bumped — sliding window) instead of appending. Every insert is
 *  pruned to the newest MAX_REVISIONS_PER_POST. */
function snapshotPost(post: Post, reason: string): void {
  const conn = db();
  const newest = conn
    .query("SELECT id, reason, created_at FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT 1")
    .get(post.id) as { id: number; reason: string; created_at: string } | null;
  const ts = now();
  const title = post.title ?? "";
  const content = post.content ?? "";
  const wc = wordCount(content);
  if (newest && newest.reason === "edit" && Date.now() - Date.parse(newest.created_at) < COALESCE_MS) {
    conn.run(
      "UPDATE revisions SET title = ?, content = ?, word_count = ?, created_at = ? WHERE id = ?",
      [title, content, wc, ts, newest.id],
    );
    return;
  }
  conn.run(
    "INSERT INTO revisions (post_id, title, content, word_count, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [post.id, title, content, wc, reason, ts],
  );
  conn.run(
    `DELETE FROM revisions WHERE post_id = ? AND id NOT IN (
       SELECT id FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT ?
     )`,
    [post.id, post.id, MAX_REVISIONS_PER_POST],
  );
}
```

4. In the `PUT` branch of `if (segments.length === 3)` (the `/api/posts/:id` handler), insert the snapshot between computing the new values and the `UPDATE`:

```ts
      if (title !== post.title || content !== post.content) {
        snapshotPost(post, "edit");
      }
```

so the branch becomes:

```ts
    if (method === "PUT") {
      const body = await readBody(req);
      const title = typeof body.title === "string" ? body.title : post.title;
      const content = typeof body.content === "string" ? body.content : post.content;
      let targetWordCount = post.target_word_count ?? 0;
      if (typeof body.target_word_count === "number" && body.target_word_count >= 0) {
        targetWordCount = Math.floor(body.target_word_count);
      } else if (body.target_word_count === null) {
        targetWordCount = 0;
      }
      if (title !== post.title || content !== post.content) {
        snapshotPost(post, "edit");
      }
      db().run(
        "UPDATE posts SET title = ?, content = ?, target_word_count = ?, updated_at = ? WHERE id = ?",
        [title, content, targetWordCount, now(), id],
      );
      return json(getPost(id));
    }
```

5. In the publish toggle handler (`segments.length === 4 && segments[3] === "publish"`), snapshot before the status update:

```ts
    const status = post.status === "published" ? "draft" : "published";
    snapshotPost(post, post.status === "published" ? "unpublish" : "publish");
    db().run("UPDATE posts SET status = ?, updated_at = ? WHERE id = ?", [status, now(), id]);
```

6. In the `DELETE` branch, delete revisions first, then the post:

```ts
    if (method === "DELETE") {
      db().run("DELETE FROM revisions WHERE post_id = ?", [id]);
      db().run("DELETE FROM posts WHERE id = ?", [id]);
      return json({ ok: true });
    }
```

- [ ] **Step 5: Run the full suite**

Run: `bun test src/server.test.ts`
Expected: all five new tests PASS, all existing tests still PASS (the "full lifecycle" test's exact-key assertion on the summary shape is untouched).

---

### Task 2: Revision read routes — list, detail, diff — plus the deterministic line diff

**Files:**
- Modify: `src/server.ts` — `lineDiff` + `splitLines` exports; three new routes in `handleApi` (after the `stats` block, before the `segments.length === 3` block)
- Test: `src/server.test.ts` — tests for items 5, 6, 7; extend the 404 sweep

**Interfaces:**
- Consumes: `revisions` table, `Revision` type, `wordCount`, `now` (from Task 1)
- Produces: `export function lineDiff(oldText: string, newText: string): { op: "+" | "-" | " "; text: string }[]`; `GET /api/posts/:id/revisions`, `GET /api/posts/:id/revisions/:rev`, `GET /api/posts/:id/revisions/:rev/diff`. Task 4's UI consumes the list + diff routes.

- [ ] **Step 1: Write the failing tests**

Append to `src/server.test.ts`:

```ts
test("GET /api/posts/:id/revisions returns newest-first {id, created_at, word_count, reason}", async () => {
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
  expect(Object.keys(list[0]).sort()).toEqual(["created_at", "id", "reason", "word_count"]);
  expect(list[0].id).toBeGreaterThan(list[1].id); // newest first
  expect(list[0].reason).toBe("edit");
  expect(list[0].word_count).toBe(2); // pre-edit content "two"
  expect(typeof list[0].created_at).toBe("string");
  expect(list[0]).not.toHaveProperty("content");
  expect(list[0]).not.toHaveProperty("title");

  const missing = await api("/posts/999999/revisions");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });
});

test("GET /api/posts/:id/revisions/:rev returns the full snapshot, 404 for other posts", async () => {
  const a = await (await post("/posts", { title: "A", content: "alpha one" })).json();
  const b = await (await post("/posts", { title: "B", content: "beta" })).json();
  await put(`/posts/${a.id}`, { content: "alpha two" });
  await put(`/posts/${b.id}`, { content: "beta two" });

  const revId = (await (await api(`/posts/${a.id}/revisions`)).json())[0].id;

  const res = await api(`/posts/${a.id}/revisions/${revId}`);
  expect(res.status).toBe(200);
  const rev = await res.json();
  expect(rev.id).toBe(revId);
  expect(rev.post_id).toBe(a.id);
  expect(rev.title).toBe("A");
  expect(rev.content).toBe("alpha one");
  expect(rev.reason).toBe("edit");
  expect(rev.word_count).toBe(2);

  const cross = await api(`/posts/${b.id}/revisions/${revId}`);
  expect(cross.status).toBe(404);
  expect(await cross.json()).toEqual({ error: "not found" });

  const unknown = await api(`/posts/${a.id}/revisions/999999`);
  expect(unknown.status).toBe(404);

  const bad = await api(`/posts/${a.id}/revisions/abc`);
  expect(bad.status).toBe(404);
});

test("lineDiff is a deterministic, hand-written line diff over {op, text}", async () => {
  const { lineDiff } = await import("./server.ts");

  // identical text → all " "
  expect(lineDiff("a\nb", "a\nb")).toEqual([
    { op: " ", text: "a" },
    { op: " ", text: "b" },
  ]);
  // empty text → no lines
  expect(lineDiff("", "")).toEqual([]);
  // insertion in the middle: added and removed lines interleave with context
  expect(lineDiff("one\ntwo\nthree", "one\nTWO\nthree\nfour")).toEqual([
    { op: " ", text: "one" },
    { op: "-", text: "two" },
    { op: "+", text: "TWO" },
    { op: " ", text: "three" },
    { op: "+", text: "four" },
  ]);
  // deterministic: same inputs, same array, every run
  const again = lineDiff("one\ntwo\nthree", "one\nTWO\nthree\nfour");
  expect(again).toEqual([
    { op: " ", text: "one" },
    { op: "-", text: "two" },
    { op: "+", text: "TWO" },
    { op: " ", text: "three" },
    { op: "+", text: "four" },
  ]);
});

test("GET /api/posts/:id/revisions/:rev/diff diffs the snapshot against current content", async () => {
  const created = await (await post("/posts", { title: "D", content: "one\ntwo\nthree" })).json();
  await put(`/posts/${created.id}`, { content: "one\nTWO\nthree\nfour" });
  const rev = (await (await api(`/posts/${created.id}/revisions`)).json())[0];

  const res = await api(`/posts/${created.id}/revisions/${rev.id}/diff`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    { op: " ", text: "one" },
    { op: "-", text: "two" },
    { op: "+", text: "TWO" },
    { op: " ", text: "three" },
    { op: "+", text: "four" },
  ]);

  // identical snapshot vs current → all " " (publish snapshot holds the pre-toggle state == current)
  await post(`/posts/${created.id}/publish`);
  const publishRev = (await (await api(`/posts/${created.id}/revisions`)).json())[0];
  const identical = await (await api(`/posts/${created.id}/revisions/${publishRev.id}/diff`)).json();
  expect(identical.length).toBeGreaterThan(0);
  expect(identical.every((op: any) => op.op === " ")).toBe(true);

  // 404 when the revision belongs to a different post
  const other = await (await post("/posts", { title: "Other", content: "x" })).json();
  const cross = await api(`/posts/${other.id}/revisions/${rev.id}/diff`);
  expect(cross.status).toBe(404);
});
```

Extend the existing "unknown id returns 404 {error: 'not found'} on every route" test's `routes` array with:

```ts
    api(`/posts/${missing}/revisions`),
    api(`/posts/${missing}/revisions/1`),
    api(`/posts/${missing}/revisions/1/diff`),
    post(`/posts/${missing}/revisions/1/restore`),
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test src/server.test.ts`
Expected: the four new tests FAIL (`lineDiff` not exported, routes 404), the extended sweep FAILS (revision routes on missing id are not 404 yet — they fall through to `notFound()` so they may already pass; only the four new tests are required to fail).

- [ ] **Step 3: Implement `splitLines` and `lineDiff` in `src/server.ts`**

Add after `snapshotPost`:

```ts
const splitLines = (s: string): string[] => (s === "" ? [] : s.split("\n"));

/** Deterministic line diff: LCS over lines (ties prefer "-" over "+"), so the
 *  same inputs always produce the same ordered array. Identical text → all " ". */
export function lineDiff(oldText: string, newText: string): { op: "+" | "-" | " "; text: string }[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: { op: "+" | "-" | " "; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "-", text: a[i] });
      i++;
    } else {
      out.push({ op: "+", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ op: "-", text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ op: "+", text: b[j] });
    j++;
  }
  return out;
}
```

- [ ] **Step 4: Implement the three read routes in `handleApi`**

Insert after the existing `/api/posts/:id/stats` block and before the `if (segments.length === 3)` block:

```ts
  // /api/posts/:id/revisions
  if (segments.length === 4 && segments[3] === "revisions") {
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    if (!getPost(id)) return notFound();
    const rows = db()
      .query("SELECT id, created_at, word_count, reason FROM revisions WHERE post_id = ? ORDER BY id DESC")
      .all(id) as { id: number; created_at: string; word_count: number; reason: string }[];
    return json(rows);
  }

  // /api/posts/:id/revisions/:rev
  if (segments.length === 5 && segments[3] === "revisions") {
    const revId = Number(segments[4]);
    if (!Number.isInteger(revId)) return notFound();
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    const rev = db().query("SELECT * FROM revisions WHERE id = ? AND post_id = ?").get(revId, id) as
      | Revision
      | null;
    if (!rev) return notFound();
    return json(rev);
  }

  // /api/posts/:id/revisions/:rev/diff
  if (segments.length === 6 && segments[3] === "revisions" && segments[5] === "diff") {
    const revId = Number(segments[4]);
    if (!Number.isInteger(revId)) return notFound();
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const rev = db()
      .query("SELECT content FROM revisions WHERE id = ? AND post_id = ?")
      .get(revId, id) as { content: string | null } | null;
    if (!rev) return notFound();
    return json(lineDiff(rev.content ?? "", post.content ?? ""));
  }
```

- [ ] **Step 5: Run the full suite**

Run: `bun test src/server.test.ts`
Expected: the four new tests PASS, the extended sweep PASSES, everything else still green.

---

### Task 3: Restore route

**Files:**
- Modify: `src/server.ts` — one new route in `handleApi` (next to the diff route)
- Test: `src/server.test.ts` — test for item 8

**Interfaces:**
- Consumes: `snapshotPost`, `Revision` type, `getPost` (all from Task 1)
- Produces: `POST /api/posts/:id/revisions/:rev/restore` → returns the updated post. Task 4's UI consumes it.

- [ ] **Step 1: Write the failing test**

Append to `src/server.test.ts`:

```ts
test("restore snapshots the pre-restore state first, applies the revision, and is undoable", async () => {
  const created = await (await post("/posts", { title: "R", content: "one" })).json();
  await put(`/posts/${created.id}`, { content: "two" });
  const db = new Database(process.env.INKWELL_DB!);
  db.run("UPDATE revisions SET created_at = '2020-01-01T00:00:00.000Z'"); // force append
  db.close();
  await put(`/posts/${created.id}`, { content: "three" });

  const list = await (await api(`/posts/${created.id}/revisions`)).json();
  const revTwo = await (await api(`/posts/${created.id}/revisions/${list[0].id}`)).json();
  expect(revTwo.content).toBe("two"); // the newest revision holds the pre-edit state of the last PUT

  await Bun.sleep(5);
  const before = await (await api(`/posts/${created.id}`)).json();

  const res = await post(`/posts/${created.id}/revisions/${revTwo.id}/restore`);
  expect(res.status).toBe(200);
  const restored = await res.json();
  expect(restored.title).toBe("R");
  expect(restored.content).toBe("two");
  expect(restored.updated_at > before.updated_at).toBe(true);

  // the pre-restore state ("three") was snapshotted first, with reason "restore"
  const after = await (await api(`/posts/${created.id}/revisions`)).json();
  expect(after.length).toBe(3);
  expect(after[0].reason).toBe("restore");
  const restoreSnap = await (await api(`/posts/${created.id}/revisions/${after[0].id}`)).json();
  expect(restoreSnap.content).toBe("three");

  // so a restore is itself undoable: restoring the "restore" snapshot brings "three" back
  const undo = await (await post(`/posts/${created.id}/revisions/${after[0].id}/restore`)).json();
  expect(undo.content).toBe("three");

  // restoring a revision that belongs to a different post 404s
  const other = await (await post("/posts", { title: "O", content: "x" })).json();
  const cross = await post(`/posts/${other.id}/revisions/${revTwo.id}/restore`);
  expect(cross.status).toBe(404);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `bun test src/server.test.ts`
Expected: the new test FAILS (route 404s), everything else green.

- [ ] **Step 3: Implement the restore route**

Insert next to the diff route (after it, still before the `if (segments.length === 3)` block):

```ts
  // /api/posts/:id/revisions/:rev/restore
  if (segments.length === 6 && segments[3] === "revisions" && segments[5] === "restore") {
    const revId = Number(segments[4]);
    if (!Number.isInteger(revId)) return notFound();
    if (method !== "POST") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const rev = db().query("SELECT * FROM revisions WHERE id = ? AND post_id = ?").get(revId, id) as
      | Revision
      | null;
    if (!rev) return notFound();
    snapshotPost(post, "restore"); // pre-restore state first — a restore is itself undoable
    db().run("UPDATE posts SET title = ?, content = ?, updated_at = ? WHERE id = ?", [
      rev.title ?? "",
      rev.content ?? "",
      now(),
      id,
    ]);
    return json(getPost(id));
  }
```

- [ ] **Step 4: Run the full suite**

Run: `bun test src/server.test.ts`
Expected: the new test PASSES, everything else still green.

---

### Task 4: UI — history control, panel, diff view, restore

**Files:**
- Modify: `src/public/index.html` — footer history button; history modal after the shortcuts modal
- Modify: `src/public/app.js` — `ui` entries; `// --- history (pure) ---` + `// --- history (dom) ---` sections; Escape handling; event wiring
- Modify: `src/public/style.css` — history panel + diff block (before the scrollbars section)
- Test: `src/server.test.ts` — tests for item 10

**Interfaces:**
- Consumes: `GET /api/posts/:id/revisions`, `GET /api/posts/:id/revisions/:rev/diff`, `POST /api/posts/:id/revisions/:rev/restore` (Tasks 2–3); existing `escapeHtml`, `relTime`, `api`, `mergeSummary`, `renderEditor`, `flushSave`, `current` from app.js
- Produces: `openHistory()`, `closeHistory()`, `renderHistoryList()`, `selectRevision(revId)`, `restoreRevision()`; pure `renderDiffLines(ops)` and `revisionReasonText(reason)` in the `// --- history (pure) ---` section (loadable via the test file's `loadSection`)

- [ ] **Step 1: Write the failing UI tests**

Append to `src/server.test.ts`:

```ts
test("index.html contains the history control in the footer and the history panel", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('id="history-btn"');
  expect(html).toContain('id="history-modal"');
  expect(html).toContain('id="history-list"');
  expect(html).toContain('id="history-diff"');
  expect(html).toContain('id="history-restore"');
  expect(html).toContain('id="history-close"');
  // the control lives in the editor footer
  const footer = html.slice(html.indexOf('<footer class="footer">'), html.indexOf("</footer>"));
  expect(footer).toContain('id="history-btn"');
  // the panel reuses the modal pattern
  const modal = html.slice(html.indexOf('id="history-modal"'), html.indexOf("</div>", html.indexOf('id="history-modal"')) + 6);
  expect(modal).toContain('role="dialog"');
});

test("app.js wires history panel, diff rendering, and restore", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();
  expect(js).toContain("openHistory");
  expect(js).toContain("closeHistory");
  expect(js).toContain("renderHistoryList");
  expect(js).toContain("selectRevision");
  expect(js).toContain("restoreRevision");
  expect(js).toContain("/revisions");
  expect(js).toContain("/diff");
  expect(js).toContain("/restore");
  expect(js).toContain("historyRestore");
});

test("history diff rendering escapes HTML and marks added/removed lines (pure section)", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();

  const { renderDiffLines, revisionReasonText } = loadSection<any>(js, "history (pure)", [
    "renderDiffLines",
    "revisionReasonText",
  ]);
  expect(revisionReasonText("edit")).toBe("edit");
  expect(revisionReasonText("publish")).toBe("published");
  expect(revisionReasonText("unpublish")).toBe("unpublished");
  expect(revisionReasonText("restore")).toBe("restored");
  expect(revisionReasonText("weird")).toBe("weird");

  const html = renderDiffLines([
    { op: "+", text: "<script>alert(1)</script>" },
    { op: "-", text: "gone line" },
    { op: " ", text: "keep" },
  ]);
  expect(html).toContain("diff-add");
  expect(html).toContain("diff-del");
  expect(html).toContain("diff-ctx");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});

test("style.css styles the history panel and the diff", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();
  expect(css).toContain(".history-content");
  expect(css).toContain(".history-list");
  expect(css).toContain(".history-item");
  expect(css).toContain(".history-diff");
  expect(css).toContain(".diff-add");
  expect(css).toContain(".diff-del");
  expect(css).toContain(".diff-ctx");
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test src/server.test.ts`
Expected: the four new UI tests FAIL (elements/strings not present yet), everything else green.

- [ ] **Step 3: Add the history control and panel to `src/public/index.html`**

1. In the editor footer, after `<span class="spacer"></span>`:

```html
    <button id="history-btn" class="btn" type="button" title="Revision history">history</button>
```

2. Immediately after the `shortcuts-modal` block (before the `<script type="module" src="app.js"></script>` tag):

```html
<div id="history-modal" class="modal-backdrop" hidden>
  <div class="modal-content history-content" role="dialog" aria-labelledby="history-title" aria-modal="true">
    <div class="modal-header">
      <h2 id="history-title" class="modal-title">History</h2>
      <button id="history-close" class="close-btn" type="button" aria-label="Close">&times;</button>
    </div>
    <ul id="history-list" class="history-list"></ul>
    <div id="history-diff" class="history-diff" aria-live="polite"></div>
    <div class="history-actions">
      <span id="history-meta" class="meta"></span>
      <span class="spacer"></span>
      <button id="history-restore" class="btn" type="button" disabled>restore this version</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Add the history logic to `src/public/app.js`**

1. Add to the `ui` object:

```ts
  historyBtn: el('history-btn'),
  historyModal: el('history-modal'),
  historyList: el('history-list'),
  historyDiff: el('history-diff'),
  historyRestore: el('history-restore'),
  historyMeta: el('history-meta'),
  historyClose: el('history-close'),
```

2. Add two new sections. Place `// --- history (pure) ---` BEFORE `// --- history (dom) ---` (the test's `loadSection` slices to the next `// --- ` marker). Insert both after the existing `// --- quiet room: font size, reading time, goal` section and before `// --- search`:

```js
// --- history (pure) ------------------------------------------------------

function revisionReasonText(reason) {
  const labels = { edit: 'edit', publish: 'published', unpublish: 'unpublished', restore: 'restored' };
  return labels[reason] || reason;
}

function renderDiffLines(ops) {
  return ops.map(({ op, text }) => {
    const cls = op === '+' ? 'diff-add' : op === '-' ? 'diff-del' : 'diff-ctx';
    return `<div class="diff-line ${cls}"><span class="diff-op">${op}</span><span class="diff-text">${escapeHtml(text)}</span></div>`;
  }).join('\n');
}

// --- history (dom) -------------------------------------------------------

let historyRevisions = [];
let selectedRevId = null;

async function openHistory() {
  if (!current) return;
  await flushSave(); // list reflects the latest snapshot
  historyRevisions = await api('GET', `/api/posts/${current.id}/revisions`);
  selectedRevId = null;
  renderHistoryList();
  ui.historyDiff.innerHTML = '';
  ui.historyMeta.textContent = '';
  ui.historyRestore.disabled = true;
  ui.historyModal.hidden = false;
}

function closeHistory() {
  ui.historyModal.hidden = true;
}

function renderHistoryList() {
  ui.historyList.replaceChildren(...historyRevisions.map((rev) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'history-item' + (rev.id === selectedRevId ? ' active' : '');
    item.dataset.id = rev.id;

    const when = document.createElement('span');
    when.className = 'history-when';
    when.textContent = relTime(rev.created_at);

    const detail = document.createElement('span');
    detail.className = 'history-detail';
    detail.textContent = `${rev.word_count} words · ${revisionReasonText(rev.reason)}`;

    item.append(when, detail);
    item.addEventListener('click', () => selectRevision(rev.id));
    return item;
  }));
}

async function selectRevision(revId) {
  selectedRevId = revId;
  renderHistoryList();
  const ops = await api('GET', `/api/posts/${current.id}/revisions/${revId}/diff`);
  ui.historyDiff.innerHTML = renderDiffLines(ops);
  const rev = historyRevisions.find((r) => r.id === revId);
  ui.historyMeta.textContent = rev ? `${revisionReasonText(rev.reason)} · ${rev.word_count} words` : '';
  ui.historyRestore.disabled = false;
}

async function restoreRevision() {
  if (!current || !selectedRevId) return;
  current = await api('POST', `/api/posts/${current.id}/revisions/${selectedRevId}/restore`);
  mergeSummary(current);
  renderEditor();
  closeHistory();
}
```

3. Wire events with the other listeners (near the `ui.shortcutsToggle?.addEventListener…` block):

```js
ui.historyBtn?.addEventListener('click', () => openHistory());
ui.historyClose?.addEventListener('click', () => closeHistory());
ui.historyRestore?.addEventListener('click', () => restoreRevision());
ui.historyModal?.addEventListener('click', (e) => {
  if (e.target === ui.historyModal) closeHistory();
});
```

4. In the document-level `keydown` Escape branch, close the history modal first (before the drawer check):

```js
  } else if (e.key === 'Escape') {
    if (!ui.shortcutsModal.hidden) {
      e.preventDefault();
      toggleShortcutsModal(false);
    } else if (ui.historyModal && !ui.historyModal.hidden) {
      e.preventDefault();
      closeHistory();
    } else if (ui.drawer.classList.contains('open')) {
```

- [ ] **Step 5: Add the history styles to `src/public/style.css`**

Add a `/* --- history panel --- */` block after the modal/key-hints section and before `/* --- scrollbars --- */`:

```css
/* --- history panel ------------------------------------------------------ */

.history-content { max-width: 720px; }

.history-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-dim);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.history-item:hover { color: var(--text); background: var(--surface-2); }
.history-item.active { color: var(--accent); border-color: var(--border); }

.history-when { font-weight: 600; }
.history-detail { color: var(--text-faint); }

.history-diff {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-1);
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.5;
  padding: 8px 0;
}

.diff-line { display: flex; gap: 8px; padding: 0 12px; white-space: pre-wrap; }
.diff-op { width: 1ch; color: var(--text-faint); user-select: none; }
.diff-add .diff-text { color: var(--accent); }
.diff-del .diff-text { color: var(--danger); text-decoration: line-through; }
.diff-ctx .diff-text { color: var(--text-dim); }

.history-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.history-actions .btn:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 6: Run the full suite**

Run: `bun test src/server.test.ts`
Expected: all four new UI tests PASS, the whole suite green.

---

## Verification

1. `bun test src/server.test.ts` — entire suite green, including a test for every numbered "Done means" item:
   - item 1: `migrates a pre-revisions database in place and leaves existing posts intact`
   - item 2: `PUT snapshots the pre-edit row, and only when title or content actually changed`
   - item 3: `autosave coalescing: edit revisions younger than 60s are overwritten, not appended`
   - item 4: `publish toggle snapshots with reason publish/unpublish, never coalescing`
   - item 5: `GET /api/posts/:id/revisions returns newest-first {id, created_at, word_count, reason}`
   - item 6: `GET /api/posts/:id/revisions/:rev returns the full snapshot, 404 for other posts`
   - item 7: `lineDiff is a deterministic, hand-written line diff over {op, text}` + `GET …/diff diffs the snapshot against current content`
   - item 8: `restore snapshots the pre-restore state first, applies the revision, and is undoable`
   - item 9: `at most 50 revisions per post — oldest pruned; deleting a post deletes its revisions`
   - item 10: the four UI tests (index.html, app.js wiring, pure diff section, style.css)
2. Manual smoke (optional): `bun run src/server.ts`, open the editor, type (watch revisions coalesce in History), pause > 60 s, type again (a second revision appears), restore one, and undo the restore.
