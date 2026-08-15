// inkwell — minimalist blog writing app. Bun + bun:sqlite, zero dependencies.
// Run: bun run src/server.ts   (PORT and INKWELL_DB env overrides supported)

import { Database } from "bun:sqlite";

const APP_DIR = import.meta.dir;
const PUBLIC_DIR = `${APP_DIR}/public`;
const PORT = Number(process.env.PORT ?? 4501);

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

// ─── db ────────────────────────────────────────────────────────────────────
// Opened lazily so INKWELL_DB can be set by a test before the first request.
let _db: Database | null = null;
let ftsAvailable = false;

function db(): Database {
  if (_db) return _db;
  const path = process.env.INKWELL_DB || `${APP_DIR}/inkwell.db`;
  _db = new Database(path, { create: true });
  _db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT,
      status TEXT DEFAULT 'draft',
      target_word_count INTEGER DEFAULT 0,
      publish_at TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);
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
  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

const now = () => new Date().toISOString();

const wordCount = (content: string) =>
  content.trim() === "" ? 0 : content.trim().split(/\s+/).length;

const getPost = (id: number) =>
  db().query("SELECT * FROM posts WHERE id = ?").get(id) as Post | null;

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

/** Snapshots a post's pre-edit state. 'edit' snapshots coalesce: if the newest
 *  revision for this post is an 'edit' younger than 60s, it is overwritten
 *  (created_at bumped — sliding window) instead of appending. Publish,
 *  unpublish, and restore snapshots never coalesce — they always append.
 *  Every insert is pruned to the newest MAX_REVISIONS_PER_POST. */
function snapshotPost(post: Post, reason: string): void {
  const conn = db();
  const newest = conn
    .query("SELECT id, reason, created_at FROM revisions WHERE post_id = ? ORDER BY id DESC LIMIT 1")
    .get(post.id) as { id: number; reason: string; created_at: string } | null;
  const ts = now();
  const title = post.title ?? "";
  const content = post.content ?? "";
  const wc = wordCount(content);
  if (reason === "edit" && newest && newest.reason === "edit" && Date.now() - Date.parse(newest.created_at) < COALESCE_MS) {
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
  // Ensure the db is opened and ftsAvailable is decided before branching:
  // on a fresh process the first request may be a search, and db() is what
  // creates posts_fts and flips the flag.
  db();
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

// ─── responses ─────────────────────────────────────────────────────────────
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const notFound = () => json({ error: "not found" }, 404);

/** Reads a JSON body, tolerating an empty one. Throws on malformed JSON. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.trim() === "") return {};
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

// ─── static ────────────────────────────────────────────────────────────────
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).slice(1);
  if (rel.includes("..")) return new Response("forbidden", { status: 403 });

  const file = Bun.file(`${PUBLIC_DIR}/${rel}`);
  if (!(await file.exists())) return new Response("not found", { status: 404 });

  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return new Response(file, {
    headers: { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" },
  });
}

// ─── api ───────────────────────────────────────────────────────────────────
async function handleApi(req: Request, pathname: string): Promise<Response> {
  const segments = pathname.split("/").filter(Boolean); // ["api", "posts", ...]
  const method = req.method.toUpperCase();

  if (segments[1] === "stats") {
    if (segments.length === 2) {
      if (method === "GET") {
        const row = db()
          .query(
            "SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'published' THEN 1 END) as published, COUNT(CASE WHEN status = 'draft' THEN 1 END) as drafts FROM posts",
          )
          .get() as { total: number; published: number; drafts: number };
        const posts = db().query("SELECT content FROM posts").all() as { content: string | null }[];
        const totalWords = posts.reduce((sum, p) => sum + wordCount(p.content ?? ""), 0);
        return json({
          total: row.total,
          published: row.published,
          drafts: row.drafts,
          total_words: totalWords,
        });
      }
      return json({ error: "method not allowed" }, 405);
    }
    return notFound();
  }

  if (segments[1] === "tags") {
    if (segments.length === 2) {
      if (method === "GET") {
        const tableInfo = db().query("PRAGMA table_info(posts)").all() as { name: string }[];
        const hasTagsColumn = tableInfo.some((col) => col.name === "tags");

        const posts = hasTagsColumn
          ? (db().query("SELECT title, tags FROM posts").all() as { title: string | null; tags?: string | null }[])
          : (db().query("SELECT title FROM posts").all() as { title: string | null });

        const tagCounts: Record<string, number> = {};

        for (const post of posts) {
          const postTags = new Set<string>();

          if (
            hasTagsColumn &&
            typeof (post as { tags?: string | null }).tags === "string" &&
            (post as { tags: string }).tags.trim() !== ""
          ) {
            const rawTags = (post as { tags: string }).tags.split(",");
            for (const rawTag of rawTags) {
              const trimmed = rawTag.trim();
              if (trimmed) {
                postTags.add(trimmed);
              }
            }
          } else {
            const title = post.title ?? "";
            const hashtagMatches = title.match(/#([^\s#]+)/g) || [];
            for (const match of hashtagMatches) {
              const tag = match.slice(1).replace(/[.,!?:;'"()\[\]{}]+$/, "").trim();
              if (tag) {
                postTags.add(tag);
              }
            }
          }

          for (const tag of postTags) {
            tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
          }
        }

        const tags = Object.entries(tagCounts)
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => {
            if (b.count !== a.count) {
              return b.count - a.count;
            }
            return a.tag.localeCompare(b.tag);
          });

        return json({ tags });
      }
      return json({ error: "method not allowed" }, 405);
    }
    return notFound();
  }

  if (segments[1] === "scheduled") {
    if (segments.length === 3 && segments[2] === "run" && method === "POST") {
      return json({ published: sweepScheduled() });
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (segments[1] !== "posts") return notFound();

  // /api/posts
  if (segments.length === 2) {
    if (method === "GET") {
      sweepScheduled();
      const url = new URL(req.url);
      const query = url.searchParams.get("q") ?? url.searchParams.get("search") ?? "";
      const trimmed = query.trim();
      if (trimmed) return json(searchPosts(trimmed));
      const rows = db()
        .query("SELECT * FROM posts ORDER BY updated_at DESC, id DESC")
        .all() as Post[];
      return json(rows.map(summarize));
    }

    if (method === "POST") {
      const body = await readBody(req);
      const title = typeof body.title === "string" ? body.title : "Untitled";
      const content = typeof body.content === "string" ? body.content : "";
      const targetWordCount =
        typeof body.target_word_count === "number" && body.target_word_count >= 0
          ? Math.floor(body.target_word_count)
          : 0;
      const ts = now();
      const { lastInsertRowid } = db().run(
        "INSERT INTO posts (title, content, status, target_word_count, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?)",
        [title, content, targetWordCount, ts, ts],
      );
      return json(getPost(Number(lastInsertRowid)), 201);
    }

    return json({ error: "method not allowed" }, 405);
  }

  const id = Number(segments[2]);
  if (!Number.isInteger(id)) return notFound();

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

  // /api/posts/:id/stats
  if (segments.length === 4 && segments[3] === "stats") {
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const wc = wordCount(post.content ?? "");
    const readingMinutes = wc === 0 ? 0 : Math.ceil(wc / 200);
    return json({
      word_count: wc,
      reading_minutes: readingMinutes,
      status: post.status,
    });
  }

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

  // /api/posts/:id
  if (segments.length === 3) {
    if (method === "GET") sweepScheduled();
    const post = getPost(id);
    if (!post) return notFound();

    if (method === "GET") return json(post);

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

    if (method === "DELETE") {
      db().run("DELETE FROM revisions WHERE post_id = ?", [id]);
      db().run("DELETE FROM posts WHERE id = ?", [id]);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  }

  return notFound();
}

// ─── entry ─────────────────────────────────────────────────────────────────
export async function handleRequest(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (pathname === "/ping" && req.method === "GET") {
    return new Response("pong", { headers: { "content-type": "text/plain" } });
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    try {
      return await handleApi(req, pathname);
    } catch (err) {
      if (err instanceof SyntaxError) return json({ error: "malformed JSON body" }, 400);
      return json({ error: String(err) }, 500);
    }
  }

  return serveStatic(pathname);
}

if (import.meta.main) {
  const server = Bun.serve({ port: PORT, fetch: handleRequest });
  console.log(`inkwell listening on http://localhost:${server.port}`);
}
