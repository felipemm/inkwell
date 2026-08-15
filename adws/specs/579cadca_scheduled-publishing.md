# Scheduled Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third post status, `scheduled`, with a `publish_at` timestamp that turns a draft into a published post the moment it comes due — decided at request time, never by a timer.

**Architecture:** `db()` adds a `publish_at TEXT` column via `ALTER TABLE … ADD COLUMN` in a try/catch (same in-place pattern already used for `target_word_count`), so existing `inkwell.db` files upgrade on next open and existing rows stay valid. A single module-level `sweepScheduled(): number[]` publishes every row where `status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= now` (all values are `new Date().toISOString()` UTC strings, so SQL `<=` is a correct chronological compare). It runs on demand from `POST /api/scheduled/run` and automatically at the top of `GET /api/posts` (plain and `?q=`) and `GET /api/posts/:id`, so the list is never stale. New routes `POST`/`DELETE /api/posts/:id/schedule` set and cancel the schedule; the existing publish toggle nulls `publish_at` in both directions. The client gets a `datetime-local` input plus a schedule button in the editor footer (label flips to "cancel schedule" once set, displays local time, sends UTC) and a distinct `.dot.scheduled` marker in the post list. Pure helpers live in a `// --- scheduled (pure) ---` app.js section, exercised through the existing `loadSection` test pattern.

**Tech Stack:** Bun (bun:sqlite), vanilla JS/CSS client. No new dependencies, no `package.json` edits.

**Spec:** `adws/prompts/03-scheduled-publishing.md`

**Path note:** the app lives under `src/` (`src/server.ts`, `src/server.test.ts`, `src/public/index.html`, `src/public/app.js`, `src/public/style.css`). Tests run with `bun test src/server.test.ts` (package.json `"test": "bun test"`).

## Global Constraints

- **Bun + bun:sqlite only.** No new dependencies, no `package.json` edits, vanilla JS on the client.
- **Migrate in place.** `CREATE TABLE IF NOT EXISTS posts (… publish_at TEXT …)` for fresh DBs **and** `ALTER TABLE posts ADD COLUMN publish_at TEXT` in a try/catch for existing DBs — both inside `db()`. Existing rows keep working; their `publish_at` is `NULL`.
- **Status is exactly one of `draft`, `scheduled`, `published`.** No route may write any other value.
- **Store UTC only.** `publish_at` is always `new Date(raw).toISOString()` (ISO-8601 UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`) or `NULL`. Never store a local-zone string in the db.
- **No `setInterval`, no timers, no background worker, no cron.** Due-ness is decided only by comparing timestamps at request time — inside `sweepScheduled()`, which is called from `POST /api/scheduled/run` and from `GET /api/posts` / `GET /api/posts/:id`.
- **`GET /api/posts` summary shape is unchanged.** `summarize()` keeps its exact keys; the existing exact-key assertion (`["id","status","title","updated_at","word_count","target_word_count"]`) must pass untouched.
- **Publish toggle semantics:** publishing a scheduled post cancels its schedule (status → `published`, `publish_at` → `NULL`); unpublishing a published post clears `publish_at`.
- **Tests are deterministic by choosing timestamps, not by waiting:** schedule in the past then sweep and assert published; schedule far in the future (e.g. `2999-01-01T00:00:00.000Z`) then sweep twice and assert it stays scheduled and nothing else moved. Never `Bun.sleep` to make a schedule come due.
- **`bun test src/server.test.ts` stays green** and gains tests for every numbered "Done means" item (1–9).
- **The builder never commits.** The factory owns every commit; the plan's steps end at running the tests.
- **Out of scope:** recurring or repeating schedules, a timezone picker, scheduled unpublishing, email/webhook notification on publish, a calendar or queue view, editing `publish_at` through `PUT /api/posts/:id`, any external scheduler, adding a `schedule` revision-history snapshot.

---

### Task 1: `publish_at` migration + schedule/cancel routes (items 1, 2, 3)

**Files:**
- Modify: `src/server.ts` — `Post` type, `db()` migration, new `schedule` route branch
- Test: `src/server.test.ts` — migration, POST schedule, DELETE schedule, 400/404/409 edges

**Interfaces:**
- Consumes: existing `Post` type, `db()`, `getPost()`, `now()`, `readBody()`, `json()`, `notFound()`
- Produces: `Post.publish_at: string | null`; the `publish_at` column (created on every `db()` open); `POST /api/posts/:id/schedule` and `DELETE /api/posts/:id/schedule`. Tasks 2–4 consume the column and the routes.

- [ ] **Step 1: Write the failing tests (items 1–3 plus edges)**

Append to `src/server.test.ts` (after the revision-history tests):

```ts
test("migrates a pre-schedule database in place and leaves existing rows valid", async () => {
  const dbPath = join(tmpdir(), `inkwell-schedule-migrate-${Date.now()}-${process.pid}.db`);
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
  closeDb(); // next request re-opens against the pre-schedule file and upgrades it
  try {
    const res = await api("/posts");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].title).toBe("Legacy");
    expect(data[0].status).toBe("draft"); // the legacy row is still valid

    const check = new Database(dbPath);
    const cols = (check.query("PRAGMA table_info(posts)").all() as any[]).map((c) => c.name);
    expect(cols).toContain("publish_at");
    check.close();
  } finally {
    closeDb();
    process.env.INKWELL_DB = prev;
    for (const suffix of ["", "-shm", "-wal"]) rmSync(dbPath + suffix, { force: true });
  }
});

test("POST /api/posts/:id/schedule sets status scheduled and stores UTC ISO", async () => {
  const created = await (await post("/posts", { title: "Sched", content: "x" })).json();

  // a full UTC ISO timestamp is stored unchanged (normalized to UTC ISO form)
  const res = await post(`/posts/${created.id}/schedule`, { publish_at: "2999-01-01T13:05:00.000Z" });
  expect(res.status).toBe(200);
  const scheduled = await res.json();
  expect(scheduled.status).toBe("scheduled");
  expect(scheduled.publish_at).toBe("2999-01-01T13:05:00.000Z");

  // a zone-less ISO string (interpreted in the server's local zone) is normalized to UTC
  const res2 = await post(`/posts/${created.id}/schedule`, { publish_at: "2999-01-01T09:00" });
  const scheduled2 = await res2.json();
  expect(scheduled2.status).toBe("scheduled");
  expect(scheduled2.publish_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(new Date(scheduled2.publish_at).toISOString()).toBe(scheduled2.publish_at);

  // the list summary carries the new state through status
  const list = await (await api("/posts")).json();
  expect(list.find((p: { id: number }) => p.id === created.id).status).toBe("scheduled");
});

test("POST schedule with missing, unparseable, or non-string publish_at returns 400 {error}", async () => {
  const created = await (await post("/posts", { title: "Bad", content: "x" })).json();
  for (const body of [{}, { publish_at: "not-a-date" }, { publish_at: 12345 }, { publish_at: null }]) {
    const res = await post(`/posts/${created.id}/schedule`, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  }
  const after = await (await api(`/posts/${created.id}`)).json();
  expect(after.status).toBe("draft");
  expect(after.publish_at).toBeNull();
});

test("DELETE /api/posts/:id/schedule returns the post to draft and nulls publish_at; 409 when not scheduled", async () => {
  const created = await (await post("/posts", { title: "Cancel", content: "x" })).json();
  await post(`/posts/${created.id}/schedule`, { publish_at: "2999-01-01T00:00:00.000Z" });

  const res = await api(`/posts/${created.id}/schedule`, { method: "DELETE" });
  expect(res.status).toBe(200);
  const back = await res.json();
  expect(back.status).toBe("draft");
  expect(back.publish_at).toBeNull();

  // not scheduled → 409 {error}
  const again = await api(`/posts/${created.id}/schedule`, { method: "DELETE" });
  expect(again.status).toBe(409);
  expect((await again.json()).error).toBeTruthy();

  // published → also 409
  await post(`/posts/${created.id}/publish`);
  const onPublished = await api(`/posts/${created.id}/schedule`, { method: "DELETE" });
  expect(onPublished.status).toBe(409);
});
```

Then extend the existing `"unknown id returns 404 {error: 'not found'} on every route"` test's `routes` array with:

```ts
    post(`/posts/${missing}/schedule`),
    api(`/posts/${missing}/schedule`, { method: "DELETE" }),
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/server.test.ts`
Expected: the five new tests FAIL (404/400/409 statuses or `publish_at` undefined), because the column and routes do not exist yet.

- [ ] **Step 3: Add `publish_at` to the `Post` type**

In `src/server.ts`, extend the type:

```ts
type Post = {
  id: number;
  title: string;
  content: string;
  status: string;
  target_word_count: number;
  publish_at: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 4: Add the `publish_at` column to the schema and migrate existing DBs in place**

In `db()`, add `publish_at TEXT` to the `CREATE TABLE IF NOT EXISTS posts` statement (for fresh DBs) and add a second try/catch `ALTER TABLE` right after the `target_word_count` one (for existing DBs):

```ts
  try {
    _db.run("ALTER TABLE posts ADD COLUMN target_word_count INTEGER DEFAULT 0");
  } catch {
    // Column already exists
  }
  try {
    _db.run("ALTER TABLE posts ADD COLUMN publish_at TEXT");
  } catch {
    // Column already exists
  }
```

- [ ] **Step 5: Add the schedule/cancel route branch**

In `handleApi`, right after the existing `// /api/posts/:id/publish` block, add:

```ts
  // /api/posts/:id/schedule — POST sets a publish time; DELETE cancels it
  if (segments.length === 4 && segments[3] === "schedule") {
    const post = getPost(id);
    if (!post) return notFound();

    if (method === "POST") {
      const body = await readBody(req);
      const raw = body.publish_at;
      if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
        return json({ error: "publish_at must be a parseable ISO-8601 timestamp" }, 400);
      }
      const publishAt = new Date(raw).toISOString(); // normalize to UTC ISO
      db().run(
        "UPDATE posts SET status = 'scheduled', publish_at = ?, updated_at = ? WHERE id = ?",
        [publishAt, now(), id],
      );
      return json(getPost(id));
    }

    if (method === "DELETE") {
      if (post.status !== "scheduled") return json({ error: "post is not scheduled" }, 409);
      db().run(
        "UPDATE posts SET status = 'draft', publish_at = NULL, updated_at = ? WHERE id = ?",
        [now(), id],
      );
      return json(getPost(id));
    }

    return json({ error: "method not allowed" }, 405);
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/server.test.ts`
Expected: all tests pass, including the five new ones and the extended 404 test. The existing `"full lifecycle"` and `"creates a post with defaults"` tests still pass — new posts get `publish_at` `NULL`.

---

### Task 2: Sweep engine + sweep-on-read (items 4, 5, 8)

**Files:**
- Modify: `src/server.ts` — `sweepScheduled()` helper, `POST /api/scheduled/run` route, sweep calls in the two GET handlers
- Test: `src/server.test.ts` — sweep + idempotency, sweep-on-read, method-not-allowed

**Interfaces:**
- Consumes: `db()`, `now()`, `json()` from Task 1's server
- Produces: `sweepScheduled(): number[]` (published ids in ascending id order); `POST /api/scheduled/run` → `{ published: number[] }`. Task 3's tests rely on the sweep route; Task 4's UI relies on the sweep-on-read behavior.

- [ ] **Step 1: Write the failing tests (items 4, 5, 8)**

Append to `src/server.test.ts`:

```ts
test("POST /api/scheduled/run publishes due posts, keeps publish_at, and is idempotent", async () => {
  const due = await (await post("/posts", { title: "Due", content: "x" })).json();
  await post(`/posts/${due.id}/schedule`, { publish_at: new Date(Date.now() - 60_000).toISOString() }); // already due
  const future = await (await post("/posts", { title: "Future", content: "y" })).json();
  await post(`/posts/${future.id}/schedule`, { publish_at: "2999-01-01T00:00:00.000Z" });
  const control = await (await post("/posts", { title: "Control", content: "z" })).json();

  const r1 = await (await post("/scheduled/run")).json();
  expect(r1.published).toContain(due.id);
  expect(r1.published).not.toContain(future.id);

  // idempotent: a second call immediately after publishes nothing
  const r2 = await (await post("/scheduled/run")).json();
  expect(r2).toEqual({ published: [] });

  const dueNow = await (await api(`/posts/${due.id}`)).json();
  expect(dueNow.status).toBe("published");
  expect(dueNow.publish_at).toBeTruthy(); // kept as the record of when

  const futureNow = await (await api(`/posts/${future.id}`)).json();
  expect(futureNow.status).toBe("scheduled"); // far future: nothing moved

  const controlNow = await (await api(`/posts/${control.id}`)).json();
  expect(controlNow.status).toBe("draft"); // non-scheduled posts never move

  // non-POST methods on /api/scheduled/run are 405
  const bad = await api("/scheduled/run");
  expect(bad.status).toBe(405);
});

test("GET /api/posts and GET /api/posts/:id sweep due posts first, so the list is never stale", async () => {
  const p = await (await post("/posts", { title: "SweepOnRead", content: "x" })).json();
  await post(`/posts/${p.id}/schedule`, { publish_at: new Date(Date.now() - 60_000).toISOString() });

  // the plain list already shows it published — no explicit sweep call
  const list = await (await api("/posts")).json();
  expect(list.find((s: { id: number }) => s.id === p.id).status).toBe("published");

  // search results use the same GET /api/posts route, so they are not stale either
  const p2 = await (await post("/posts", { title: "SweepOnReadSearch", content: "y" })).json();
  await post(`/posts/${p2.id}/schedule`, { publish_at: new Date(Date.now() - 60_000).toISOString() });
  const hits = await (await api("/posts?q=SweepOnReadSearch")).json();
  expect(hits.find((s: { id: number }) => s.id === p2.id).status).toBe("published");

  // GET /api/posts/:id sweeps before reading
  const p3 = await (await post("/posts", { title: "SweepOnReadSingle", content: "z" })).json();
  await post(`/posts/${p3.id}/schedule`, { publish_at: new Date(Date.now() - 60_000).toISOString() });
  const fetched = await (await api(`/posts/${p3.id}`)).json();
  expect(fetched.status).toBe("published");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/server.test.ts`
Expected: the two new tests FAIL — `/api/scheduled/run` returns 404 and the sweep never runs, so the posts stay `scheduled`.

- [ ] **Step 3: Add the `sweepScheduled` helper**

In `src/server.ts`, right after `const getPost = ...`, add:

```ts
/** Publishes every scheduled post whose publish_at has arrived. Due-ness is
 *  decided by comparing timestamps at request time — no timers, no workers —
 *  so a restart never loses a schedule and tests never wait. Returns the ids
 *  published in this sweep, in ascending id order. */
function sweepScheduled(): number[] {
  const conn = db();
  const cutoff = now();
  const due = conn
    .query(
      "SELECT id FROM posts WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= ? ORDER BY id",
    )
    .all(cutoff) as { id: number }[];
  if (due.length === 0) return [];
  conn.run(
    "UPDATE posts SET status = 'published', updated_at = ? WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= ?",
    [cutoff, cutoff],
  );
  return due.map((r) => r.id);
}
```

(All `publish_at` values are `toISOString()` UTC strings and `cutoff` is one too, so the SQL `<=` is a correct chronological comparison.)

- [ ] **Step 4: Add the `POST /api/scheduled/run` route**

In `handleApi`, right after the `segments[1] === "tags"` block and BEFORE the `if (segments[1] !== "posts") return notFound();` line, add:

```ts
  if (segments[1] === "scheduled") {
    if (segments.length === 2 && method === "POST") {
      return json({ published: sweepScheduled() });
    }
    return json({ error: "method not allowed" }, 405);
  }
```

- [ ] **Step 5: Sweep before the two GET handlers**

In `handleApi`, in the `GET /api/posts` branch, make the sweep the first statement:

```ts
    if (method === "GET") {
      sweepScheduled();
      const url = new URL(req.url);
      const query = url.searchParams.get("q") ?? url.searchParams.get("search") ?? "";
```

In the `segments.length === 3` (`/api/posts/:id`) block, sweep before reading the post (GET only):

```ts
  if (segments.length === 3) {
    if (method === "GET") sweepScheduled();
    const post = getPost(id);
    if (!post) return notFound();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/server.test.ts`
Expected: all tests pass. In particular the new sweep tests pass deterministically (past timestamp → published on first sweep; `2999` future → still scheduled after two sweeps), with no `Bun.sleep` anywhere in them.

---

### Task 3: Publish-toggle interplay + full-post `publish_at` (items 6, 7)

**Files:**
- Modify: `src/server.ts` — publish route nulls `publish_at`
- Test: `src/server.test.ts` — toggle-cancels-schedule, full-post shape

**Interfaces:**
- Consumes: `sweepScheduled()`/`POST /api/scheduled/run` and the schedule routes from Tasks 1–2; `summarize()` as-is
- Produces: nothing new for later tasks — this locks the item-6/7 behavior and guards the summary shape.

- [ ] **Step 1: Write the failing tests (items 6, 7)**

Append to `src/server.test.ts`:

```ts
test("publish toggle cancels a schedule; unpublishing clears publish_at", async () => {
  const created = await (await post("/posts", { title: "Toggle", content: "x" })).json();
  await post(`/posts/${created.id}/schedule`, { publish_at: "2999-01-01T00:00:00.000Z" });

  // publishing a scheduled post publishes it now and cancels the schedule
  const published = await (await post(`/posts/${created.id}/publish`)).json();
  expect(published.status).toBe("published");
  expect(published.publish_at).toBeNull();

  // unpublishing clears publish_at too
  const unpublished = await (await post(`/posts/${created.id}/publish`)).json();
  expect(unpublished.status).toBe("draft");
  expect(unpublished.publish_at).toBeNull();

  // a post swept to published keeps publish_at as the record of when
  const due = await (await post("/posts", { title: "DueToggle", content: "y" })).json();
  await post(`/posts/${due.id}/schedule`, { publish_at: new Date(Date.now() - 60_000).toISOString() });
  await post("/scheduled/run");
  const dueNow = await (await api(`/posts/${due.id}`)).json();
  expect(dueNow.status).toBe("published");
  expect(dueNow.publish_at).toBeTruthy();
});

test("GET /api/posts/:id includes publish_at; the list summary shape is unchanged", async () => {
  const created = await (await post("/posts", { title: "Shape", content: "x" })).json();
  await post(`/posts/${created.id}/schedule`, { publish_at: "2999-01-01T00:00:00.000Z" });

  // the full post carries publish_at
  const full = await (await api(`/posts/${created.id}`)).json();
  expect(full.publish_at).toBe("2999-01-01T00:00:00.000Z");
  expect(full.status).toBe("scheduled");

  // the summary keeps its exact key set — status alone carries the new state
  const list = await (await api("/posts")).json();
  const summary = list.find((p: { id: number }) => p.id === created.id);
  expect(Object.keys(summary).sort()).toEqual(
    ["id", "status", "title", "updated_at", "word_count", "target_word_count"].sort(),
  );
  expect(summary.status).toBe("scheduled");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/server.test.ts`
Expected: the toggle test FAILS (`publish_at` is not nulled by the publish route). The shape test may already pass — that is fine; it is a guard.

- [ ] **Step 3: Null `publish_at` in the publish toggle**

In `src/server.ts`, change the publish route's UPDATE so both toggle directions clear the schedule:

```ts
  // /api/posts/:id/publish — toggles draft ↔ published. Publishing a scheduled
  // post publishes it now and cancels its schedule; unpublishing clears publish_at.
  if (segments.length === 4 && segments[3] === "publish") {
    if (method !== "POST") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const status = post.status === "published" ? "draft" : "published";
    snapshotPost(post, post.status === "published" ? "unpublish" : "publish");
    db().run("UPDATE posts SET status = ?, publish_at = NULL, updated_at = ? WHERE id = ?", [status, now(), id]);
    return json(getPost(id));
  }
```

Do NOT touch `summarize()` — it already picks its keys explicitly, so the added column cannot leak into the list summary.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/server.test.ts`
Expected: all tests pass. The pre-existing `"full lifecycle"` test's exact-key assertion (line ~84) passes untouched, and so does this task's duplicate guard.

---

### Task 4: UI — schedule control, cancel state, scheduled list marker (item 9)

**Files:**
- Modify: `src/public/index.html` — schedule input + button in the editor footer
- Modify: `src/public/app.js` — `ui` refs, `// --- scheduled (pure) ---` section, `renderList` dot, `renderEditor` state, click handler
- Modify: `src/public/style.css` — `--schedule` tokens, `.dot.scheduled`, `.schedule-input`, `.btn.is-scheduled`
- Test: `src/server.test.ts` — markup, pure helpers, wiring, styles

**Interfaces:**
- Consumes: the API from Tasks 1–3 (`POST`/`DELETE /api/posts/:id/schedule`, full post with `status` + `publish_at`), the existing `loadSection`/`section` test helpers
- Produces: `dotClass(status)`, `scheduleButtonLabel(status)`, `toLocalInputValue(iso)`, `toUtcIso(localValue)` — pure functions in a `// --- scheduled (pure) ---` section; DOM ids `schedule-at` and `schedule-btn`; CSS class `.dot.scheduled`.

- [ ] **Step 1: Write the failing tests**

Append to `src/server.test.ts`:

```ts
test("index.html contains the schedule control in the editor footer", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('id="schedule-at"');
  expect(html).toContain('id="schedule-btn"');
  expect(html).toContain('type="datetime-local"');
  // the control lives in the editor footer (last </footer> in the document)
  const footer = html.slice(html.indexOf('<footer class="footer">'), html.lastIndexOf("</footer>"));
  expect(footer).toContain('id="schedule-at"');
  expect(footer).toContain('id="schedule-btn"');
});

test("scheduled helpers: dotClass, scheduleButtonLabel, toLocalInputValue, toUtcIso (pure section)", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();

  const { dotClass, scheduleButtonLabel, toLocalInputValue, toUtcIso } = loadSection<any>(js, "scheduled (pure)", [
    "dotClass",
    "scheduleButtonLabel",
    "toLocalInputValue",
    "toUtcIso",
  ]);

  expect(dotClass("published")).toBe("published");
  expect(dotClass("scheduled")).toBe("scheduled");
  expect(dotClass("draft")).toBe("draft");
  expect(dotClass("weird")).toBe("draft");

  expect(scheduleButtonLabel("scheduled")).toBe("cancel schedule");
  expect(scheduleButtonLabel("draft")).toBe("schedule");
  expect(scheduleButtonLabel("published")).toBe("schedule");

  // datetime-local round trip: display local, send UTC, and the instant survives
  const iso = "2026-08-18T13:05:00.000Z";
  const local = toLocalInputValue(iso);
  expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  expect(new Date(local).toISOString()).toBe(iso);
  expect(toLocalInputValue("garbage")).toBe("");

  const utc = toUtcIso("2026-08-18T13:05");
  expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(toLocalInputValue(utc)).toBe("2026-08-18T13:05"); // minutes survive the round trip
  expect(toUtcIso("")).toBe("");
});

test("app.js wires the schedule control and marks scheduled posts in the list", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();
  expect(js).toContain("scheduleAt");
  expect(js).toContain("scheduleBtn");
  expect(js).toContain("dotClass");
  expect(js).toContain("/schedule");
  expect(js).toContain("cancel schedule");
});

test("style.css styles the scheduled dot and the schedule control", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();
  expect(css).toContain(".dot.scheduled");
  expect(css).toContain(".schedule-input");
  expect(css).toContain("--schedule:");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/server.test.ts`
Expected: the four new tests FAIL — `schedule-at`/`schedule-btn` are missing, and `loadSection` throws `section "scheduled (pure)" not found in app.js`.

- [ ] **Step 3: Add the schedule control to the editor footer**

In `src/public/index.html`, inside `<footer class="footer">` right after `<span class="spacer"></span>` and before the history button, add:

```html
    <input id="schedule-at" class="schedule-input" type="datetime-local" aria-label="Schedule publish time">
    <button id="schedule-btn" class="btn" type="button">schedule</button>
```

- [ ] **Step 4: Add the pure helpers section to app.js**

In `src/public/app.js`, insert a new section directly after the existing `// --- history (pure) ---` section:

```js
// --- scheduled (pure) ------------------------------------------------------

function dotClass(status) {
  return status === 'published' ? 'published' : status === 'scheduled' ? 'scheduled' : 'draft';
}

function scheduleButtonLabel(status) {
  return status === 'scheduled' ? 'cancel schedule' : 'schedule';
}

/** datetime-local value (local time, no seconds) for a UTC ISO timestamp. */
function toLocalInputValue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** UTC ISO timestamp for a datetime-local value ("2026-08-18T09:00"). */
function toUtcIso(localValue) {
  return localValue ? new Date(localValue).toISOString() : '';
}
```

- [ ] **Step 5: Wire the schedule control in app.js**

Add to the `ui` object in `src/public/app.js`:

```js
  scheduleAt: el('schedule-at'),
  scheduleBtn: el('schedule-btn'),
```

In `renderList()`, replace the dot class line:

```js
    const dot = document.createElement('span');
    dot.className = 'dot ' + dotClass(p.status);
    dot.title = p.status;
```

In `renderEditor()`, after the publish button lines, set the schedule control state (shows the writer's local time when set, empty otherwise):

```js
  ui.scheduleBtn.textContent = scheduleButtonLabel(current.status);
  ui.scheduleBtn.classList.toggle('is-scheduled', current.status === 'scheduled');
  ui.scheduleAt.value = current.status === 'scheduled' && current.publish_at
    ? toLocalInputValue(current.publish_at)
    : '';
```

Add a click handler next to the existing `ui.publishBtn.addEventListener('click', …)` block:

```js
ui.scheduleBtn.addEventListener('click', async () => {
  if (!current) return;
  await flushSave();
  if (current.status === 'scheduled') {
    current = await api('DELETE', `/api/posts/${current.id}/schedule`);
  } else {
    const value = ui.scheduleAt.value;
    if (!value) { ui.scheduleAt.focus(); return; }
    current = await api('POST', `/api/posts/${current.id}/schedule`, { publish_at: toUtcIso(value) });
  }
  mergeSummary(current);
  renderEditor();
});
```

- [ ] **Step 6: Add the scheduled styles**

In `src/public/style.css`, add the token to `:root` (next to `--danger`) and to `[data-theme="light"]`:

```css
  --schedule: #e3b341;
```

```css
  --schedule: #8a5a00;
```

Then append a new block at the end of the file (token-only, no hex/rgba literals):

```css
/* --- scheduled publishing ------------------------------------------------- */

.schedule-input {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  padding: 3px 6px;
}

.dot.scheduled {
  background: var(--schedule);
  box-shadow: 0 0 6px color-mix(in srgb, var(--schedule) 55%, transparent);
}

.btn.is-scheduled { color: var(--schedule); }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test src/server.test.ts`
Expected: all tests pass, including the four new UI tests.

- [ ] **Step 8: Manual smoke check**

Run: `bun run src/server.ts`, open `http://localhost:4501`:
1. Create a post; open the drawer — the dot is the default draft color.
2. In the footer, pick a time a few minutes ahead in the `datetime-local` input and click `schedule` — the button flips to `cancel schedule`, the input shows the same local time, and the list dot turns amber (`--schedule`).
3. Click `cancel schedule` — back to draft, dot back to draft color.
4. Schedule a time in the past, then refresh the page — the sweep runs on the first `GET /api/posts`, and the post shows as published with a green dot.
5. Stop and restart the server with the same `inkwell.db` — a future-scheduled post is still `scheduled` after restart (nothing is lost; due-ness re-evaluated on next request).

---

### Task 5: Full-suite verification

**Files:**
- Test: `src/server.test.ts` (no changes unless a failure says otherwise)

- [ ] **Step 1: Run the whole suite**

Run: `bun test src/server.test.ts`
Expected: every test passes — the pre-existing suite (including the untouched exact-key summary assertion in `"full lifecycle"`) plus every new test from Tasks 1–4.

- [ ] **Step 2: Confirm the constraints held**

- `grep -n "publish_at" src/server.ts` — the column appears in the CREATE TABLE, one try/catch `ALTER TABLE`, the schedule route, the publish route, and `sweepScheduled`; no route writes a status other than `draft`/`scheduled`/`published`.
- `grep -rn "setInterval\|setTimeout\|cron\|Bun.sleep" src/server.ts` — no timers/workers/sleeps in the server (the test file's existing `Bun.sleep` calls are only for `updated_at` ordering and are untouched).
- `grep -n "toISOString" src/server.ts` — `now()` and the schedule route both produce UTC ISO; no local-zone string is ever stored.
