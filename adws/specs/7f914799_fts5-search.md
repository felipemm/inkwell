# FTS5 Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Inkwell's naive `LIKE '%term%'` post filter with a SQLite FTS5 full-text index that ranks results by relevance and returns a `<mark>`-highlighted snippet per hit, keeping the unfiltered list response byte-for-byte the same shape.

**Architecture:** On db open, `db()` creates a standalone FTS5 virtual table `posts_fts(title, content)` (own copy of the content — plain `DELETE FROM posts_fts WHERE rowid = ?` works in triggers), backfills it idempotently from existing rows, and installs INSERT/UPDATE/DELETE triggers so the index tracks `posts` automatically. `GET /api/posts?q=…` builds a prefix query (`term* term2*`, implicit AND), matches via `posts_fts MATCH`, orders by FTS5's `rank` (bm25, lower = better), and picks a snippet from the title when the hit is there, else from content, with `snippet()`'s `<mark>` markers. If FTS5 is unavailable (module missing) or a MATCH query is a syntax error (lone `"`, `AND`, `*`, `foo NEAR bar)`), `searchPosts` falls back to `likeSearchPosts`, which keeps the identical response contract — summary keys + `snippet` + `rank` — with a simple occurrence-count rank so "best match first" still holds. The client renders the snippet under each search hit, escaping all HTML except the `<mark>` tags.

**Tech Stack:** Bun 1.3.14, `bun:sqlite` (verified FTS5 available in this build), vanilla JS/CSS client. No new dependencies, no `package.json` edits.

**Spec:** `adws/prompts/01-fts5-search.md`

**Path note:** the spec says `apps/inkwell/*`, but this repo was reorganized — the app lives under `src/` (`src/server.ts`, `src/server.test.ts`, `src/public/`). The tests run with `bun test` (package.json `"test": "bun test"`), or specifically `bun test src/server.test.ts`.

## Global Constraints

- **Bun + bun:sqlite only.** No new dependencies, no `package.json` edits, vanilla JS on the client.
- **FTS5 availability detected at db-open time.** If `CREATE VIRTUAL TABLE … USING fts5` throws (module not linked), fall back to the current LIKE path while still producing `snippet` and `rank`. The HTTP contract is identical either way; the suite must pass under both paths.
- **Migrate in place.** An `inkwell.db` written before this change keeps working without deletion, and its existing posts are searchable after first open.
- **Unfiltered list shape unchanged.** `GET /api/posts` rows keep exactly `id, status, title, updated_at, word_count, target_word_count` (no `snippet`, no `rank`). The existing key-set assertion in "full lifecycle" must pass untouched.
- **Search row shape:** the six summary keys **plus exactly** `snippet` and `rank`.
- **`bun test src/server.test.ts` stays green** and gains a test for every numbered "Done means" item.
- **Out of scope:** searching revisions/deleted posts, status/tag facets, fuzzy/typo-tolerant matching, stemming, pagination, a separate search endpoint, editor/view-mode/theme changes.

---

### Task 1: FTS5 index — schema, backfill, triggers in `db()`

**Files:**
- Modify: `src/server.ts` — the `db()` function only (no query-path changes yet)
- Test: `src/server.test.ts` — two new tests

**Interfaces:**
- Consumes: nothing new
- Produces: on every `db()` open, a `posts_fts` FTS5 virtual table over `(title, content)` that (a) is created if absent, (b) is backfilled once from `posts` rows not yet indexed, (c) is kept current by `posts_ai` (AFTER INSERT), `posts_ad` (AFTER DELETE), `posts_au` (AFTER UPDATE) triggers. Module-level `let ftsAvailable = false;` is set to true only when FTS5 creation succeeds — Task 2 reads it.

- [ ] **Step 1: Add the two tests (acceptance pins; they can be green before the server change, which is fine — they lock the contract)**

Append to `src/server.test.ts`. The migration test swaps `INKWELL_DB` on a live server, so it must restore state in a `finally`:

```ts
test("migrates a pre-FTS database in place and backfills the index", async () => {
  const Database = (await import("bun:sqlite")).Database;
  const dbPath = join(tmpdir(), `inkwell-migrate-${Date.now()}-${process.pid}.db`);
  const raw = new Database(dbPath, { create: true });
  raw.run(`CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT,
    status TEXT DEFAULT 'draft', target_word_count INTEGER DEFAULT 0,
    created_at TEXT, updated_at TEXT
  )`);
  raw.run("INSERT INTO posts (title, content, status, created_at, updated_at) VALUES ('Legacy', 'ancient zqzqlegacyword draft', 'draft', '2026-01-01', '2026-01-01')");
  raw.close();

  const prev = process.env.INKWELL_DB;
  process.env.INKWELL_DB = dbPath;
  closeDb(); // next request re-opens against the pre-FTS file and upgrades it
  try {
    const res = await api("/posts?q=zqzqlegacyword");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].title).toBe("Legacy");
    expect(data[0].snippet).toContain("<mark>");
    expect(typeof data[0].rank).toBe("number");
  } finally {
    closeDb();
    process.env.INKWELL_DB = prev;
    for (const suffix of ["", "-shm", "-wal"]) rmSync(dbPath + suffix, { force: true });
  }
});

test("posts_fts stays current through insert, update, and delete — no explicit reindex", async () => {
  // INSERT fires the index trigger: a new word is immediately searchable
  const created = await (await post("/posts", { title: "Trigger Test", content: "zqzqinsertterm appears here" })).json();
  let hits = await (await api("/posts?q=zqzqinsertterm")).json();
  expect(hits.some((p: { id: number }) => p.id === created.id)).toBe(true);

  // UPDATE removes the old token and indexes the new one
  await api(`/posts/${created.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "zqzqreplaceterm only now" }),
  });
  hits = await (await api("/posts?q=zqzqinsertterm")).json();
  expect(hits.some((p: { id: number }) => p.id === created.id)).toBe(false);
  hits = await (await api("/posts?q=zqzqreplaceterm")).json();
  expect(hits.some((p: { id: number }) => p.id === created.id)).toBe(true);

  // DELETE removes it from the index
  await api(`/posts/${created.id}`, { method: "DELETE" });
  hits = await (await api("/posts?q=zqzqreplaceterm")).json();
  expect(hits.some((p: { id: number }) => p.id === created.id)).toBe(false);
});
```

- [ ] **Step 2: Run the tests to see the current baseline**

Run: `bun test src/server.test.ts`
Expected: both new tests PASS (the LIKE path already satisfies them; they pin the contract so later refactors can't silently drop it).

- [ ] **Step 3: Implement the FTS5 schema + backfill + triggers in `db()`**

In `src/server.ts`:

1. Add a module-level flag near `let _db: Database | null = null;`:
```ts
let ftsAvailable = false;
```

2. Inside `db()`, immediately after the existing `ALTER TABLE posts ADD COLUMN target_word_count …` try/catch, add:
```ts
  try {
    _db.run("CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(title, content)");
    ftsAvailable = true;
  } catch {
    ftsAvailable = false; // FTS5 not linked into this sqlite build → LIKE fallback everywhere
  }
  if (ftsAvailable) {
    // Idempotent backfill: existing dbs get indexed once; reopens are no-ops.
    _db.run(
      "INSERT INTO posts_fts(rowid, title, content) SELECT id, title, content FROM posts WHERE id NOT IN (SELECT rowid FROM posts_fts)",
    );
    _db.run(`CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END`);
    _db.run(`CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
      DELETE FROM posts_fts WHERE rowid = old.id;
    END`);
    _db.run(`CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
      DELETE FROM posts_fts WHERE rowid = old.id;
      INSERT INTO posts_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END`);
  }
```

Notes:
- **Standalone FTS5 table (own content copy), NOT `content='posts'`.** The special `INSERT INTO posts_fts(posts_fts, rowid, …) VALUES('delete', …)` command is for external-content tables and fails on a standalone table with `SQL logic error`; plain `DELETE FROM posts_fts WHERE rowid = old.id` is correct here (verified empirically).
- Backfill uses `WHERE id NOT IN (SELECT rowid FROM posts_fts)` so re-running on every open never duplicates rows (verified: re-open + re-backfill keeps the row count stable).
- The triggers only exist when `ftsAvailable`, so an FTS-less build never references the missing virtual table.

- [ ] **Step 4: Run the tests**

Run: `bun test src/server.test.ts`
Expected: full suite green — both new tests pass, and every pre-existing test still passes (the query path is untouched in this task).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: backfill and maintain an FTS5 index over posts on db open"
```

---

### Task 2: FTS5 search endpoint — `snippet` + `rank`, ranking, and the LIKE fallback

**Files:**
- Modify: `src/server.ts` — types, `summarize`, `buildFtsQuery`, `searchPosts`, `likeSearchPosts`, `makeSnippet`, and the `GET /api/posts` handler
- Test: `src/server.test.ts` — new tests for items 2–7 of the spec

**Interfaces:**
- Consumes: `ftsAvailable` flag and `posts_fts` from Task 1
- Produces:
  - `export function buildFtsQuery(raw: string): string`
  - `export function searchPosts(query: string): SearchRow[]` (FTS5 with automatic LIKE fallback)
  - `export function likeSearchPosts(query: string): SearchRow[]`
  - `type SearchRow = { id: number; title: string | null; status: string; updated_at: string; word_count: number; target_word_count: number; snippet: string; rank: number }` (internal)
  - `GET /api/posts?q=…` and `?search=…` return `SearchRow[]`; empty/whitespace `q` returns the unchanged unfiltered list.

- [ ] **Step 1: Write the failing shape and behavior tests**

Append to `src/server.test.ts`:

```ts
test("search response rows carry exactly snippet and rank beyond the summary keys", async () => {
  const created = await (await post("/posts", { title: "Snippet Shape", content: "zqzqshape term inside body" })).json();
  const res = await (await api("/posts?q=zqzqshape")).json();
  const row = res.find((p: { id: number }) => p.id === created.id);
  expect(row).toBeTruthy();
  expect(Object.keys(row).sort()).toEqual(
    ["id", "status", "title", "updated_at", "word_count", "target_word_count", "snippet", "rank"].sort(),
  );
  expect(typeof row.rank).toBe("number");
  expect(typeof row.snippet).toBe("string");
  expect(row.snippet).toContain("<mark>");
  expect(row.snippet.toLowerCase()).toContain("zqzqshape");
});

test("snippet comes from the title when the hit is in the title", async () => {
  const created = await (await post("/posts", { title: "zqzqtitlehit word", content: "body without the term here" })).json();
  const res = await (await api("/posts?q=zqzqtitlehit")).json();
  const row = res.find((p: { id: number }) => p.id === created.id);
  expect(row.snippet).toContain("<mark>zqzqtitlehit</mark>");
  expect(row.snippet).not.toContain("body without");
});

test("search orders best-match first via rank, not updated_at", async () => {
  const make = (n: number) =>
    `The word zqzqrankterm appears here ${n} times: ${Array(n).fill("zqzqrankterm").join(" ")} and then some filler text to keep the document lengths comparable for both posts so bm25 ordering is predictable.`;
  const older = await (await post("/posts", { title: "Older", content: make(3) })).json();
  await Bun.sleep(5);
  const newer = await (await post("/posts", { title: "Newer", content: make(1) })).json();

  // unfiltered list still orders by updated_at: newer first
  const list = await (await api("/posts")).json();
  const ids = list.map((p: { id: number }) => p.id);
  expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));

  // search orders by relevance: the 3× post first (lower rank = better)
  const res = await (await api("/posts?q=zqzqrankterm")).json();
  const resIds = res.map((p: { id: number }) => p.id);
  expect(resIds.indexOf(older.id)).toBeLessThan(resIds.indexOf(newer.id));
  expect(res.every((p: { rank: number }) => typeof p.rank === "number")).toBe(true);
});

test("multi-word queries are AND with case-insensitive prefix terms", async () => {
  const a = await (await post("/posts", { title: "AND A", content: "zqzqandterm quantum leap in the lab" })).json();
  const b = await (await post("/posts", { title: "AND B", content: "zqzqandterm quantum only" })).json();
  const c = await (await post("/posts", { title: "AND C", content: "leap only here" })).json();

  // both words required (AND)
  const both = await (await api("/posts?q=zqzqandterm quantum")).json();
  const bothIds = both.map((p: { id: number }) => p.id);
  expect(bothIds).toContain(a.id);
  expect(bothIds).not.toContain(b.id);
  expect(bothIds).not.toContain(c.id);

  // implicit trailing * prefix-matches; explicit trailing * is not double-starred
  const pref = await (await api("/posts?q=zqzqandte")).json();
  expect(pref.some((p: { id: number }) => p.id === a.id)).toBe(true);
  const prefStar = await (await api("/posts?q=zqzqandte*")).json();
  expect(prefStar.some((p: { id: number }) => p.id === a.id)).toBe(true);

  // case-insensitive in both directions
  const upper = await (await api("/posts?q=ZQZQANDTERM")).json();
  expect(upper.some((p: { id: number }) => p.id === a.id)).toBe(true);
});

test("hostile search input returns 200 with an array, never 500", async () => {
  for (const q of ['"', "AND", "foo NEAR bar)", "*"]) {
    const res = await api(`/posts?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  }
});

test("empty or whitespace-only q returns the full unfiltered list, unchanged", async () => {
  const plain = await (await api("/posts")).json();
  const empty = await (await api("/posts?q=")).json();
  const ws = await (await api("/posts?q=%20%20")).json();
  expect(empty).toEqual(plain);
  expect(ws).toEqual(plain);
});

test("a query matching nothing returns []", async () => {
  const res = await (await api("/posts?q=zqzqno-such-term-xyzzy")).json();
  expect(res).toEqual([]);
});

test("?search= alias returns the same rows as ?q=", async () => {
  const created = await (await post("/posts", { title: "Alias Test", content: "zqzqaliasword inside" })).json();
  const q = await (await api("/posts?q=zqzqaliasword")).json();
  const s = await (await api("/posts?search=zqzqaliasword")).json();
  expect(q.map((p: { id: number }) => p.id)).toEqual(s.map((p: { id: number }) => p.id));
  expect(s[0].snippet).toContain("<mark>");
});

test("LIKE fallback search still produces snippet and rank", async () => {
  const created = await (await post("/posts", { title: "Fallback Title", content: "zqzqfallbackterm appears in body" })).json();
  const rows = likeSearchPosts("zqzqfallbackterm");
  const row = rows.find((p: { id: number }) => p.id === created.id);
  expect(row).toBeTruthy();
  expect(typeof row.rank).toBe("number");
  expect(row.snippet).toContain("<mark>");
});

test("buildFtsQuery appends a trailing * to each whitespace-separated term", () => {
  expect(buildFtsQuery("quan")).toBe("quan*");
  expect(buildFtsQuery("quantum leap")).toBe("quantum* leap*");
  expect(buildFtsQuery("quan*")).toBe("quan*"); // no double star
});
```

- [ ] **Step 2: Run the tests to verify the shape tests fail**

Run: `bun test src/server.test.ts`
Expected: FAIL — `search response rows carry exactly snippet and rank…` (rows still have 6 keys; `row.snippet` undefined), and the ranking test FAILS (LIKE returns updated_at order, so the 3× older post comes second). The hostile-input, empty-q, no-match, and alias tests still PASS (LIKE already satisfies them) — that is fine, they pin behavior.

- [ ] **Step 3: Implement the search layer in `src/server.ts`**

Add after `getPost` (before the `responses` section):

```ts
type SummaryRow = {
  id: number;
  title: string | null;
  status: string;
  updated_at: string;
  word_count: number;
  target_word_count: number;
};

type SearchRow = SummaryRow & { snippet: string; rank: number };

const summarize = (p: Post): SummaryRow => ({
  id: p.id,
  title: p.title,
  status: p.status,
  updated_at: p.updated_at,
  word_count: wordCount(p.content ?? ""),
  target_word_count: p.target_word_count ?? 0,
});

/** Turns free text into an FTS5 query: each whitespace-separated term becomes a prefix term. */
export function buildFtsQuery(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((term) => (term.endsWith("*") ? term : `${term}*`))
    .join(" ");
}

const SEARCH_SQL = `
  SELECT p.id, p.title, p.status, p.updated_at, p.target_word_count, p.content,
         rank,
         CASE WHEN snippet(posts_fts, 0, '<mark>', '</mark>', '…', 12) LIKE '%<mark>%'
              THEN snippet(posts_fts, 0, '<mark>', '</mark>', '…', 12)
              ELSE snippet(posts_fts, 1, '<mark>', '</mark>', '…', 12)
         END AS snippet
  FROM posts_fts
  JOIN posts p ON p.id = posts_fts.rowid
  WHERE posts_fts MATCH ?
  ORDER BY rank, p.updated_at DESC, p.id DESC
`;

export function searchPosts(query: string): SearchRow[] {
  if (ftsAvailable) {
    try {
      // Fresh prepare per call: FTS5 can carry stale snippet/query state across
      // reused prepared statements (observed once in testing), so never cache this.
      const rows = db().prepare(SEARCH_SQL).all(buildFtsQuery(query)) as (Post & {
        rank: number;
        snippet: string | null;
      })[];
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        updated_at: r.updated_at,
        word_count: wordCount(r.content ?? ""),
        target_word_count: r.target_word_count ?? 0,
        snippet: r.snippet ?? "",
        rank: r.rank,
      }));
    } catch {
      // FTS5 rejected the query (lone `"`, `AND`, `*`, `foo NEAR bar)`, …) → LIKE fallback.
      // The fallback produces the identical contract, so hostile input can never 500.
    }
  }
  return likeSearchPosts(query);
}

function countOccurrences(src: string, lowerQuery: string): number {
  let n = 0;
  let i = 0;
  const lower = src.toLowerCase();
  while ((i = lower.indexOf(lowerQuery, i)) !== -1) {
    n++;
    i += lowerQuery.length;
  }
  return n;
}

function makeSnippet(src: string, lowerQuery: string): string {
  const lower = src.toLowerCase();
  const at = lower.indexOf(lowerQuery);
  if (at === -1) return src.slice(0, 80);
  const start = Math.max(0, at - 30);
  const end = Math.min(src.length, at + lowerQuery.length + 90);
  let window = src.slice(start, end);
  if (start > 0) window = `…${window}`;
  if (end < src.length) window = `${window}…`;
  const out: string[] = [];
  let i = 0;
  let searchFrom = 0;
  for (;;) {
    const idx = window.toLowerCase().indexOf(lowerQuery, searchFrom);
    if (idx === -1) {
      out.push(window.slice(i));
      break;
    }
    out.push(window.slice(i, idx), "<mark>", window.slice(idx, idx + lowerQuery.length), "</mark>");
    i = idx + lowerQuery.length;
    searchFrom = i;
  }
  return out.join("");
}

/** LIKE fallback: identical response contract, crude relevance rank (title matches double-weight). */
export function likeSearchPosts(query: string): SearchRow[] {
  const pattern = `%${query}%`;
  const rows = db()
    .query("SELECT * FROM posts WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC, id DESC")
    .all(pattern, pattern) as Post[];
  const lowerQuery = query.toLowerCase();
  return rows
    .map((p) => {
      const title = p.title ?? "";
      const content = p.content ?? "";
      const titleHits = countOccurrences(title, lowerQuery);
      const contentHits = countOccurrences(content, lowerQuery);
      const src = titleHits > 0 ? title : content;
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        updated_at: p.updated_at,
        word_count: wordCount(content),
        target_word_count: p.target_word_count ?? 0,
        snippet: makeSnippet(src, lowerQuery),
        rank: -(2 * titleHits + contentHits),
      };
    })
    .sort((a, b) => a.rank - b.rank || b.updated_at.localeCompare(a.updated_at) || b.id - a.id);
}
```

Then replace the GET branch of `/api/posts` (currently the `let rows: Post[]; if (trimmed) { LIKE … } else { … }` block inside `if (segments.length === 2)`) with:

```ts
    if (method === "GET") {
      const url = new URL(req.url);
      const query = url.searchParams.get("q") ?? url.searchParams.get("search") ?? "";
      const trimmed = query.trim();
      if (trimmed) return json(searchPosts(trimmed));
      const rows = db()
        .query("SELECT * FROM posts ORDER BY updated_at DESC, id DESC")
        .all() as Post[];
      return json(rows.map(summarize));
    }
```

Update the top-of-file import in `src/server.test.ts` so the new unit tests can reach the fallback:

```ts
const { handleRequest, closeDb, likeSearchPosts, buildFtsQuery } = await import("./server.ts");
```

Design notes:
- `rank` must be referenced bare (`SELECT … rank … ORDER BY rank`) — qualifying it as `posts_fts.rank` errors with "no such column".
- The `CASE` picks `snippet(posts_fts, 0, …)` (title) only when it actually contains a `<mark>`; otherwise it uses `snippet(posts_fts, 1, …)` (content). This satisfies "title when the hit is there".
- `snippet()`'s 5th arg (`'…'`) is the ellipsis, 6th (`12`) is tokens each side of the hit.
- The server returns the snippet **raw** (content text with `<mark>` tags). The client escapes it (Task 3); escaping is deliberately not done server-side so the client's `renderSnippet` is the single escaping layer.
- `word_count` is always computed from the full `content` (like the unfiltered list), never from the snippet.

- [ ] **Step 4: Run the tests**

Run: `bun test src/server.test.ts`
Expected: all new tests PASS, all pre-existing tests PASS — including the untouched key-set assertion in "full lifecycle" (it asserts the **unfiltered** list, which still has 6 keys) and the existing `?q=`/`?search=` test (FTS5 `alpha*`, `QUANTUM*`, `beta*` match the same rows LIKE matched; `nonexistentxyz*` → `[]`).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "feat: serve /api/posts?q= from FTS5 with snippet and rank"
```

---

### Task 3: Client — render the highlighted snippet under each hit

**Files:**
- Modify: `src/public/app.js` — `renderSnippet` pure section + `renderList`
- Modify: `src/public/style.css` — `.post-snippet` and `.post-snippet mark`
- Test: `src/server.test.ts` — client assertions (fetched over HTTP like the existing app.js/css tests)

**Interfaces:**
- Consumes: `snippet` string on search-response rows (Task 2); it arrives raw with `<mark>` tags
- Produces: `renderSnippet(raw: string): string` in app.js (escapes all HTML except `<mark>`/`</mark>`); `renderList()` renders `span.post-snippet` under each hit; CSS styles it with a 2-line clamp and mark highlight

- [ ] **Step 1: Write the failing client tests**

Append to `src/server.test.ts`:

```ts
test("app.js renders the search snippet under each hit and escapes HTML", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();
  expect(js).toContain("post-snippet");
  expect(js).toContain("renderSnippet");

  const { renderSnippet } = loadSection<any>(js, "snippet (pure)", ["renderSnippet"]);
  expect(renderSnippet("")).toBe("");
  expect(renderSnippet('<mark>needle</mark> & <script>alert(1)</script>')).toContain("<mark>needle</mark>");
  expect(renderSnippet('<mark>needle</mark> & <script>alert(1)</script>')).toContain("&lt;script&gt;");
  expect(renderSnippet('<mark>needle</mark> & <script>alert(1)</script>')).not.toContain("<script>");
});

test("style.css styles the search snippet and its <mark> highlights", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();
  expect(css).toContain(".post-snippet");
  expect(css).toContain(".post-snippet mark");
  expect(css).toContain("grid-column");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/server.test.ts`
Expected: FAIL — `renderSnippet` is not defined yet (the `section()` helper throws "section not found"), and the CSS test fails on `.post-snippet`.

- [ ] **Step 3: Implement in `src/public/app.js`**

1. Add a self-contained pure section (must not call `escapeHtml` — `loadSection` slices only this section, like the existing "view mode (pure)" section). Put it right after the `// --- markdown ---` section:

```js
// --- snippet (pure) ------------------------------------------------------

function renderSnippet(raw) {
  if (!raw) return '';
  return raw
    .replace(/<mark>/g, '\u0001')
    .replace(/<\/mark>/g, '\u0002')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/\u0001/g, '<mark>')
    .replace(/\u0002/g, '</mark>');
}
```

2. In `renderList()`, after `when` is appended, add the snippet element. Current end of the item-building block is `item.append(dot, title, when);` — change it to:

```js
    const snip = document.createElement('span');
    snip.className = 'post-snippet';
    snip.innerHTML = renderSnippet(p.snippet || '');
    item.append(dot, title, when, snip);
```

The sentinel dance means the only raw HTML that survives is `<mark>`/`</mark>`; everything else (including `<script>` from post content) is escaped. Posts without a `snippet` key (unfiltered list, or posts from the previous search flow) render an empty snippet span, which the CSS keeps invisible.

- [ ] **Step 4: Implement in `src/public/style.css`**

Add after the `.post-time` rule (inside the `/* --- sidebar --- */` area):

```css
.post-snippet {
  grid-column: 2 / -1;   /* sits under the title, spanning the title+time columns */
  margin-top: 1px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-faint);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.post-snippet mark {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--text-strong);
  border-radius: 2px;
  padding: 0 1px;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/server.test.ts`
Expected: full suite green — new client tests pass, everything from Tasks 1–2 still passes.

- [ ] **Step 6: Commit**

```bash
git add src/public/app.js src/public/style.css src/server.test.ts
git commit -m "feat: render highlighted snippets under search hits"
```

---

### Task 4: Full-suite verification and smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 2: Smoke-test the server manually**

Run: `bun run src/server.ts &` then:

```bash
curl -s 'http://localhost:4501/api/posts' | head -c 300
curl -s 'http://localhost:4501/api/posts?q=your' | head -c 500
curl -s 'http://localhost:4501/api/posts?q=%22'        # lone quote → 200 + []
curl -s 'http://localhost:4501/api/posts?q=*'          # lone star → 200 + []
kill %1
```

Expected: the unfiltered list has the 6 summary keys; searches return rows with `snippet` (containing `<mark>`) and `rank`, ordered best-match first; hostile inputs return `200` arrays.

- [ ] **Step 3: Check the diff for scope leaks**

Run: `git diff --stat`
Expected: only `src/server.ts`, `src/server.test.ts`, `src/public/app.js`, `src/public/style.css` changed. No `package.json` edits, no new files in the app, no changes to editor/view-mode/theme code.

- [ ] **Step 4: Commit any stragglers**

If the smoke test revealed fixes, commit them; otherwise nothing to commit in this task:

```bash
git status --short
```

---

## Self-Review

**Spec coverage:**
1. FTS5 table + backfill + INSERT/UPDATE/DELETE triggers → Task 1 (migration test + trigger-currency test; trigger test also covers "create a post, search a word in it, comes back with no explicit reindex").
2. `?q=`/`?search=` served by FTS5, best-match first → Task 2 (`searchPosts`, `ORDER BY rank`; ranking test proves 3×-occurrence post beats a newer 1× post; the list test proves the unfiltered order still differs).
3. Exactly `snippet` + `rank` on search rows, title-when-hit, `<mark>` wrap → Task 2 (key-set test + title-snippet test + snippet containment assertions).
4. Unfiltered shape unchanged → Task 2 handler keeps `summarize`; existing "full lifecycle" key-set assertion untouched and passing.
5. AND, case-insensitive, trailing `*` prefix → Task 2 (buildFtsQuery + dedicated test with `zqzqandterm quantum`, `ZQZQANDTERM`, `zqzqandte`/`zqzqandte*`).
6. Hostile input 200+array, empty q = full list → Task 2 (hostile-input test with `"`, `AND`, `foo NEAR bar)`, `*`; empty/whitespace test).
7. No-match → `[]` → Task 2 (no-match test; pre-existing test also covers `nonexistentxyz`).
- FTS5-unavailable fallback producing snippet+rank → Task 2 (`likeSearchPosts` unit test + every HTTP test passes under the fallback on FTS-less machines; the fallback is exercised directly on FTS5 machines).
- Migrate in place → Task 1 (migration test swaps in a pre-FTS db file and asserts the legacy row is searchable with snippet+rank).

**Placeholder scan:** every step has concrete code; no TODOs.

**Type consistency:** `SearchRow` = `SummaryRow` + `snippet: string` + `rank: number` everywhere; `buildFtsQuery`/`searchPosts`/`likeSearchPosts` signatures match between Task 2 definitions and Task 2/4 call sites; `renderSnippet` is defined in Task 3 and used only there; `ftsAvailable` is declared in Task 1 and read in Task 2.

**Empirically verified during planning:** FTS5 availability in this Bun (1.3.14); standalone-table triggers with plain `DELETE FROM posts_fts WHERE rowid = ?` (the `'delete'` special command fails on standalone tables); idempotent backfill + reopen; bare `rank` in SELECT/ORDER BY (qualified name errors); `snippet()` behavior for title vs content hits; hostile inputs throwing and falling back; bm25 ranking of 3× vs 1× occurrences in similar-length docs; bare-term `quan` NOT matching (hence the mandatory `*` suffix); and the FTS5 stale-snippet risk with reused prepared statements (mitigated by fresh `prepare()` per call).
