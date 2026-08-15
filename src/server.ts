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
  created_at: string;
  updated_at: string;
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

  if (segments[1] !== "posts") return notFound();

  // /api/posts
  if (segments.length === 2) {
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

  // /api/posts/:id/publish
  if (segments.length === 4 && segments[3] === "publish") {
    if (method !== "POST") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const status = post.status === "published" ? "draft" : "published";
    db().run("UPDATE posts SET status = ?, updated_at = ? WHERE id = ?", [status, now(), id]);
    return json(getPost(id));
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

  // /api/posts/:id
  if (segments.length === 3) {
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
      db().run(
        "UPDATE posts SET title = ?, content = ?, target_word_count = ?, updated_at = ? WHERE id = ?",
        [title, content, targetWordCount, now(), id],
      );
      return json(getPost(id));
    }

    if (method === "DELETE") {
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
