// End-to-end tests: a real server over a throwaway sqlite db (INKWELL_DB).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_PATH = join(tmpdir(), `inkwell-test-${Date.now()}-${process.pid}.db`);
process.env.INKWELL_DB = DB_PATH; // read lazily on first query, so this lands in time

// Imported after the env assignment is what matters at call time, not import time.
const { handleRequest, closeDb, likeSearchPosts, buildFtsQuery } = await import("./server.ts");

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: handleRequest });
  base = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  closeDb();
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(DB_PATH + suffix, { force: true });
  }
});

const api = (path: string, init?: RequestInit) => fetch(`${base}/api${path}`, init);

const post = (path: string, body?: unknown) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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

test("starts with an empty list", async () => {
  const res = await api("/posts");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toEqual([]);
});

test("creates a post with defaults", async () => {
  const res = await post("/posts", {});
  const created = await res.json();
  expect(created.title).toBe("Untitled");
  expect(created.content).toBe("");
  expect(created.status).toBe("draft");
  expect(created.id).toBeGreaterThan(0);
  expect(created.created_at).toBeTruthy();
  expect(created.updated_at).toBeTruthy();
});

test("full lifecycle: create → list → update → publish toggle → delete", async () => {
  const created = await (await post("/posts", { title: "Ink", content: "one two three" })).json();
  const id = created.id;
  expect(created.title).toBe("Ink");
  expect(created.status).toBe("draft");

  // list carries the summary shape, newest-updated first
  const list = await (await api("/posts")).json();
  const summary = list.find((p: { id: number }) => p.id === id);
  expect(Object.keys(summary).sort()).toEqual(
    ["id", "status", "title", "updated_at", "word_count", "target_word_count"].sort(),
  );
  expect(summary.word_count).toBe(3);
  expect(list[0].id).toBe(id); // most recently updated

  // fetch one
  const fetched = await (await api(`/posts/${id}`)).json();
  expect(fetched.content).toBe("one two three");

  // partial update touches only the given field, and bumps updated_at
  await Bun.sleep(5);
  const updated = await (
    await api(`/posts/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "four five" }),
    })
  ).json();
  expect(updated.title).toBe("Ink");
  expect(updated.content).toBe("four five");
  expect(updated.updated_at > created.updated_at).toBe(true);
  expect(updated.created_at).toBe(created.created_at);

  const afterUpdate = await (await api("/posts")).json();
  expect(afterUpdate.find((p: { id: number }) => p.id === id).word_count).toBe(2);

  // publish toggles both ways
  const published = await (await post(`/posts/${id}/publish`)).json();
  expect(published.status).toBe("published");
  const unpublished = await (await post(`/posts/${id}/publish`)).json();
  expect(unpublished.status).toBe("draft");

  // delete
  const del = await api(`/posts/${id}`, { method: "DELETE" });
  expect(del.status).toBe(200);
  expect(await del.json()).toEqual({ ok: true });

  const remaining = await (await api("/posts")).json();
  expect(remaining.some((p: { id: number }) => p.id === id)).toBe(false);
});

test("list is ordered by updated_at DESC", async () => {
  const a = await (await post("/posts", { title: "A" })).json();
  await Bun.sleep(5);
  const b = await (await post("/posts", { title: "B" })).json();
  await Bun.sleep(5);
  await api(`/posts/${a.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "A again" }),
  });

  const list = await (await api("/posts")).json();
  const ids = list.map((p: { id: number }) => p.id);
  expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
});

test("unknown id returns 404 {error: 'not found'} on every route", async () => {
  const missing = 999999;
  const routes = [
    api(`/posts/${missing}`),
    api(`/posts/${missing}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "nope" }),
    }),
    post(`/posts/${missing}/publish`),
    api(`/posts/${missing}/stats`),
    api(`/posts/${missing}/revisions`),
    api(`/posts/${missing}/revisions/1`),
    api(`/posts/${missing}/revisions/1/diff`),
    post(`/posts/${missing}/revisions/1/restore`),
    post(`/posts/${missing}/schedule`),
    api(`/posts/${missing}/schedule`, { method: "DELETE" }),
  ];
  for (const res of await Promise.all(routes)) {
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  }
});

test("malformed JSON body returns 400 with an error", async () => {
  const res = await api("/posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBeTruthy();
});

test("word_count counts whitespace-split words", async () => {
  const created = await (
    await post("/posts", { content: "  spaced \n out\twords here  " })
  ).json();
  const list = await (await api("/posts")).json();
  const summary = list.find((p: { id: number }) => p.id === created.id);
  expect(summary.word_count).toBe(4);
});

test("app.js cycles view mode on Cmd+Enter", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("e.key === 'Enter'");
  expect(text).toContain("cycleViewMode()");
});

test("app.js declares escapeHtml exactly once at top level (no module-scope redeclaration)", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();
  const decls = js.match(/^function escapeHtml\(/gm) ?? [];
  expect(decls).toHaveLength(1);
});

// Pulls one `// --- <name> ---` section out of app.js so pure logic can be exercised directly.
function section(src: string, name: string): string {
  const start = src.indexOf(`// --- ${name}`);
  if (start === -1) throw new Error(`section "${name}" not found in app.js`);
  const rest = src.slice(start);
  const end = rest.indexOf("\n// --- ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

function loadSection<T>(src: string, name: string, exports: string[]): T {
  return new Function(`${section(src, name)}\nreturn { ${exports.join(", ")} };`)() as T;
}

test("index.html exposes the panes and the three mode buttons", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const html = await res.text();

  expect(html).toContain('id="panes"');
  expect(html).toContain('class="pane editor-pane"');
  expect(html).toContain('class="pane preview-pane"');
  expect(html).toContain('class="mode-switch"');

  expect(html).toContain('id="mode-edit"');
  expect(html).toContain('id="mode-split"');
  expect(html).toContain('id="mode-preview"');
  expect(html).toContain('data-mode="edit"');
  expect(html).toContain('data-mode="split"');
  expect(html).toContain('data-mode="preview"');

  expect(html).toContain('id="content"');
  expect(html).toContain('id="preview"');

  // #preview no longer ships `hidden`; visibility is CSS-driven off body[data-view-mode]
  expect(html).toContain('<div id="preview" class="preview"');
  const previewTag = html.slice(html.indexOf('id="preview"'), html.indexOf(">", html.indexOf('id="preview"')));
  expect(previewTag).not.toContain("hidden");

  // content before preview, both inside the #panes block
  expect(html.indexOf('id="panes"')).toBeLessThan(html.indexOf('id="content"'));
  expect(html.indexOf('id="content"')).toBeLessThan(html.indexOf('id="preview"'));

  // shortcuts modal advertises the cycle
  expect(html).toContain("Cycle view mode");
});

test("style.css defines all three layouts", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();

  expect(css).toContain(".panes");
  expect(css).toContain(".editor-pane");
  expect(css).toContain(".preview-pane");
  expect(css).toContain(".pane-label");
  expect(css).toContain(".mode-switch");

  expect(css).toContain('body[data-view-mode="edit"]');
  expect(css).toContain('body[data-view-mode="split"]');
  expect(css).toContain('body[data-view-mode="preview"]');

  // split adds a divider between the panes
  const splitRule = css.slice(
    css.indexOf('body[data-view-mode="split"] .preview-pane'),
    css.indexOf("}", css.indexOf('body[data-view-mode="split"] .preview-pane')),
  );
  expect(splitRule).toContain("border-left");

  // token discipline: no hex/rgba literals in the new view-modes block
  const viewModesBlock = css.slice(css.indexOf("/* --- view modes"));
  expect(viewModesBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(viewModesBlock).not.toContain("rgba(");
});

test("app.js wires mode state, buttons, and live preview", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();

  expect(js).toContain("VIEW_MODES");
  expect(js).toContain("nextViewMode");
  expect(js).toContain("setViewMode");
  expect(js).toContain("refreshPreview");
  expect(js).toContain("document.body.dataset.viewMode");
  expect(js).toContain(".mode-btn");

  expect(js).not.toContain("showPreview");
  expect(js).not.toContain("previewing");

  // the content input handler re-renders the live preview on every keystroke
  const handler = js.slice(
    js.indexOf("ui.content.addEventListener('input'"),
    js.indexOf("});", js.indexOf("ui.content.addEventListener('input'")),
  );
  expect(handler).toContain("refreshPreview()");
});

test("view-mode cycling: edit → split → preview → edit (behavioral, pure section)", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();

  const { VIEW_MODES, nextViewMode, normalizeViewMode, viewModeShowsPreview } =
    loadSection<any>(js, "view mode (pure)", ["VIEW_MODES", "nextViewMode", "normalizeViewMode", "viewModeShowsPreview"]);

  expect(VIEW_MODES).toEqual(["edit", "split", "preview"]);
  expect(nextViewMode("edit")).toBe("split");
  expect(nextViewMode("split")).toBe("preview");
  expect(nextViewMode("preview")).toBe("edit"); // wraps
  expect(nextViewMode("bogus")).toBe("split"); // unknown normalizes to edit, then advances
  expect(normalizeViewMode(undefined)).toBe("edit");
  expect(viewModeShowsPreview("edit")).toBe(false);
  expect(viewModeShowsPreview("split")).toBe(true);
  expect(viewModeShowsPreview("preview")).toBe(true);

  // three cycles from edit return to edit — every mode is reachable by the hot key
  let mode = "edit";
  const seen = [mode];
  for (let i = 0; i < 3; i++) {
    mode = nextViewMode(mode);
    seen.push(mode);
  }
  expect(seen).toEqual(["edit", "split", "preview", "edit"]);
});

test("preview rendering: markdown section renders headings, inline marks, lists, code (behavioral)", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const js = await res.text();

  const { renderMarkdown } = loadSection<any>(js, "markdown", ["renderMarkdown"]);

  const html = renderMarkdown("# Title\n\nsome **bold** and `code`\n\n- one\n- two");
  expect(html).toContain("<h1>Title</h1>");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<code>code</code>");
  expect(html).toContain("<li>one</li>");
  expect(html).toContain("<ul>");
  expect(renderMarkdown("```\nlet x = 1;\n```")).toContain("<pre><code>let x = 1;</code></pre>");
  expect(renderMarkdown("<script>alert(1)</script>")).toContain("&lt;script&gt;");
  // live-updating: successive keystroke states render different output
  expect(renderMarkdown("# a")).not.toBe(renderMarkdown("# ab"));
});

test("index.html contains shortcuts modal elements", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('id="shortcuts-modal"');
  expect(text).toContain('id="shortcuts-toggle"');
  expect(text).toContain('id="modal-close"');
  expect(text).toContain("<kbd>");
  expect(text).not.toContain("key-hint");
});

test("app.js contains keydown handlers for Cmd+N, ?, and Escape", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("e.key.toLowerCase() === 'n'");
  expect(text).toContain("e.key === '?'");
  expect(text).toContain("e.key === 'Escape'");
  expect(text).toContain("toggleShortcutsModal");
});

test("index.html contains focus mode elements", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('id="focus-toggle"');
  expect(text).toContain("Toggle focus mode");
});

test("style.css contains focus-mode styles", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("body.focus-mode .sidebar");
  expect(text).toContain("body.focus-mode .footer");
});

test("app.js contains focus mode handlers and shortcut listeners", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("toggleFocusMode");
  expect(text).toContain("e.shiftKey && e.key.toLowerCase() === 'f'");
});

test("creates post with target_word_count and updates it via PUT", async () => {
  const created = await (
    await post("/posts", { title: "Goal Test", content: "hello world", target_word_count: 500 })
  ).json();
  expect(created.target_word_count).toBe(500);

  const updated = await (
    await api(`/posts/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_word_count: 1000 }),
    })
  ).json();
  expect(updated.target_word_count).toBe(1000);

  const fetched = await (await api(`/posts/${created.id}`)).json();
  expect(fetched.target_word_count).toBe(1000);

  const list = await (await api("/posts")).json();
  const item = list.find((p: { id: number }) => p.id === created.id);
  expect(item.target_word_count).toBe(1000);
});

test("index.html contains writing goal, reading time, and font size elements", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('id="target-words"');
  expect(text).toContain('id="reading-time"');
  expect(text).toContain('id="font-increase"');
  expect(text).toContain('id="font-decrease"');
  expect(text).toContain('id="word-count"');
});

test("app.js contains reading time calculation and writing goal logic", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("calcReadingTime");
  expect(text).toContain("goalProgress");
  expect(text).toContain("setFontSize");
  expect(text).toContain("target_word_count");
});

test("index.html contains the quiet-room chrome", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('id="posts-btn"');
  expect(text).toContain('id="more-btn"');
  expect(text).toContain('id="posts-drawer"');
  expect(text).toContain('id="more-menu"');
  expect(text).toContain('class="sidebar drawer"');
  expect(text).toContain('class="popover"');
});

test("app.js opens and closes the posts drawer and more menu", async () => {
  const res = await fetch(`${base}/app.js`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("openPosts");
  expect(text).toContain("closePosts");
  expect(text).toContain("openMore");
  expect(text).toContain("closeMore");
  expect(text).toContain("e.key.toLowerCase() === 'p'");
});

test("style.css contains quiet-room drawer and popover styles", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain(".drawer");
  expect(text).toContain(".popover");
  expect(text).toContain("translateX(-100%)");
  expect(text).toContain("prefers-reduced-motion");
});

test("GET /api/posts?q= filters posts by title or content (case-insensitive)", async () => {
  const p1 = await (await post("/posts", { title: "Alpha Quantum", content: "first post body" })).json();
  const p2 = await (await post("/posts", { title: "Beta Note", content: "quantum leap inside body" })).json();
  const p3 = await (await post("/posts", { title: "Gamma Draft", content: "unrelated content" })).json();

  // Filter by title match ("alpha")
  const searchTitle = await (await api("/posts?q=alpha")).json();
  expect(searchTitle.length).toBe(1);
  expect(searchTitle[0].id).toBe(p1.id);

  // Filter by content match ("quantum") -> matches p1 title and p2 content
  const searchContent = await (await api("/posts?q=QUANTUM")).json();
  const contentIds = searchContent.map((p: { id: number }) => p.id);
  expect(contentIds).toContain(p1.id);
  expect(contentIds).toContain(p2.id);
  expect(contentIds).not.toContain(p3.id);

  // Filter with no matches
  const searchNone = await (await api("/posts?q=nonexistentxyz")).json();
  expect(searchNone).toEqual([]);

  // Alias search= parameter works identically
  const searchAlias = await (await api("/posts?search=Beta")).json();
  expect(searchAlias.length).toBe(1);
  expect(searchAlias[0].id).toBe(p2.id);
});

test("GET /api/posts/:id/stats returns post stats and 404 for unknown id", async () => {
  // Post with 0 words
  const emptyPost = await (await post("/posts", { content: "" })).json();
  const emptyStatsRes = await api(`/posts/${emptyPost.id}/stats`);
  expect(emptyStatsRes.status).toBe(200);
  expect(emptyStatsRes.headers.get("content-type")).toContain("application/json");
  expect(await emptyStatsRes.json()).toEqual({
    word_count: 0,
    reading_minutes: 0,
    status: "draft",
  });

  // Post with 150 words (<= 200 words => 1 min read)
  const words150 = Array(150).fill("word").join(" ");
  const p150 = await (await post("/posts", { content: words150 })).json();
  const stats150 = await (await api(`/posts/${p150.id}/stats`)).json();
  expect(stats150).toEqual({
    word_count: 150,
    reading_minutes: 1,
    status: "draft",
  });

  // Post with 250 words (> 200 words => 2 min read)
  const words250 = Array(250).fill("word").join(" ");
  const p250 = await (await post("/posts", { content: words250 })).json();
  const stats250 = await (await api(`/posts/${p250.id}/stats`)).json();
  expect(stats250).toEqual({
    word_count: 250,
    reading_minutes: 2,
    status: "draft",
  });

  // Toggle publish status and verify status update in stats
  await post(`/posts/${p250.id}/publish`);
  const publishedStats = await (await api(`/posts/${p250.id}/stats`)).json();
  expect(publishedStats.status).toBe("published");

  // Non-existent ID returns 404
  const missingRes = await api("/posts/9999999/stats");
  expect(missingRes.status).toBe(404);
  expect(await missingRes.json()).toEqual({ error: "not found" });

  // Non-GET method returns 405
  const postRes = await post(`/posts/${p250.id}/stats`);
  expect(postRes.status).toBe(405);
  expect(await postRes.json()).toEqual({ error: "method not allowed" });
});

test("GET /api/stats returns counts of total, published, and draft posts, and total_words", async () => {
  // Get initial stats
  const initialRes = await api("/stats");
  expect(initialRes.status).toBe(200);
  expect(initialRes.headers.get("content-type")).toContain("application/json");
  const initialStats = await initialRes.json();
  expect(typeof initialStats.total).toBe("number");
  expect(typeof initialStats.published).toBe("number");
  expect(typeof initialStats.drafts).toBe("number");
  expect(typeof initialStats.total_words).toBe("number");

  // Create a draft post with content
  const p1 = await (await post("/posts", { title: "Draft 1", content: "hello world" })).json();

  // Create another post with content and publish it
  const p2 = await (await post("/posts", { title: "Pub 1", content: "one two three" })).json();
  await post(`/posts/${p2.id}/publish`);

  const updatedStats = await (await api("/stats")).json();
  expect(updatedStats.total).toBe(initialStats.total + 2);
  expect(updatedStats.published).toBe(initialStats.published + 1);
  expect(updatedStats.drafts).toBe(initialStats.drafts + 1);
  expect(updatedStats.total_words).toBe(initialStats.total_words + 5);

  // Method not allowed for POST /api/stats
  const postRes = await post("/stats");
  expect(postRes.status).toBe(405);
});

test("index.html, app.js, and style.css contain search filter UI elements and logic", async () => {
  const htmlRes = await fetch(`${base}/index.html`);
  const html = await htmlRes.text();
  expect(html).toContain('id="search-input"');
  expect(html).toContain('id="search-clear"');
  expect(html).toContain('class="search-box"');

  const jsRes = await fetch(`${base}/app.js`);
  const js = await jsRes.text();
  expect(js).toContain("searchInput");
  expect(js).toContain("searchClear");
  expect(js).toContain("performSearch");
  expect(js).toContain("/api/posts?q=");

  const cssRes = await fetch(`${base}/style.css`);
  const css = await cssRes.text();
  expect(css).toContain(".search-box");
  expect(css).toContain(".search-input");
  expect(css).toContain(".search-clear");
});

test("GET /api/tags returns distinct tag counts sorted by count DESC, tag ASC", async () => {
  // Test 405 for POST /api/tags and 404 for subpath /api/tags/foo
  const postRes = await post("/tags");
  expect(postRes.status).toBe(405);
  expect(await postRes.json()).toEqual({ error: "method not allowed" });

  const subpathRes = await api("/tags/foo");
  expect(subpathRes.status).toBe(404);
  expect(await subpathRes.json()).toEqual({ error: "not found" });

  // Clear existing posts so we can test tag counts cleanly
  await api("/posts"); // ensure table initialized
  const Database = (await import("bun:sqlite")).Database;
  const db = new Database(process.env.INKWELL_DB!);
  db.run("DELETE FROM posts");

  // Initial GET /api/tags on empty posts table
  const emptyRes = await api("/tags");
  expect(emptyRes.status).toBe(200);
  expect(await emptyRes.json()).toEqual({ tags: [] });

  // Create posts with title hashtags
  await post("/posts", { title: "First Post #tech #bun" });
  await post("/posts", { title: "Second Post #tech #sqlite" });
  await post("/posts", { title: "Third Post #tech #bun #zebra!" });

  const tagsRes = await api("/tags");
  expect(tagsRes.status).toBe(200);
  const data = await tagsRes.json();
  expect(data).toEqual({
    tags: [
      { tag: "tech", count: 3 },
      { tag: "bun", count: 2 },
      { tag: "sqlite", count: 1 },
      { tag: "zebra", count: 1 },
    ],
  });

  // Now test with 'tags' column added to posts table
  db.run("ALTER TABLE posts ADD COLUMN tags TEXT");
  db.run("DELETE FROM posts");

  // Post 1 has explicit tags, Post 2 has explicit tags with spaces, Post 3 falls back to hashtag in title
  db.run("INSERT INTO posts (title, tags) VALUES (?, ?)", ["Explicit 1", "bun, tech, javascript"]);
  db.run("INSERT INTO posts (title, tags) VALUES (?, ?)", ["Explicit 2", "tech, bun"]);
  db.run("INSERT INTO posts (title, tags) VALUES (?, ?)", ["Hashtag Fallback #javascript", null]);

  const tagsColRes = await api("/tags");
  expect(tagsColRes.status).toBe(200);
  const dataCol = await tagsColRes.json();
  expect(dataCol).toEqual({
    tags: [
      { tag: "bun", count: 2 },
      { tag: "javascript", count: 2 },
      { tag: "tech", count: 2 },
    ],
  });

  db.close();
});

test("style.css color variables meet WCAG AA contrast standards", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();

  const getVar = (name: string): string => {
    const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!match) throw new Error(`Variable ${name} not found in style.css`);
    return match[1].trim();
  };

  const bg = getVar("--bg");
  const bgSidebar = getVar("--bg-sidebar");
  const border = getVar("--border");
  const textFaint = getVar("--text-faint");
  const textDim = getVar("--text-dim");

  function parseHex(hex: string): [number, number, number] {
    const h = hex.replace("#", "");
    const num = parseInt(h, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function relativeLuminance([r, g, b]: [number, number, number]): number {
    const rs = r / 255;
    const gs = g / 255;
    const bs = b / 255;
    const R = rs <= 0.04045 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4);
    const G = gs <= 0.04045 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4);
    const B = bs <= 0.04045 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  function contrastRatio(hex1: string, hex2: string): number {
    const l1 = relativeLuminance(parseHex(hex1));
    const l2 = relativeLuminance(parseHex(hex2));
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // 1. --text-faint contrast ratio >= 4.5:1 against --bg and --bg-sidebar
  expect(contrastRatio(textFaint, bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(textFaint, bgSidebar)).toBeGreaterThanOrEqual(4.5);

  // 2. --text-dim contrast ratio >= 4.5:1 against input/hover dark backgrounds (#11161e and #161b22)
  expect(contrastRatio(textDim, "#11161e")).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(textDim, "#161b22")).toBeGreaterThanOrEqual(4.5);

  // 3. --border contrast ratio against --bg is >= 1.5:1
  expect(contrastRatio(border, bg)).toBeGreaterThanOrEqual(1.5);

  // 4. Focus visible rules present
  expect(css).toContain(":focus-visible");
});

test("index.html contains brand vector icon and relocated new-post button in list-head", async () => {
  const res = await fetch(`${base}/index.html`);
  expect(res.status).toBe(200);
  const html = await res.text();

  // Brand header icon present
  expect(html).toContain('class="brand-icon"');
  expect(html).toContain('<svg class="brand-icon"');
  expect(html).toContain('viewBox="0 0 32 32"');
  expect(html).toContain('stroke-width="2.5"');
  expect(html).toContain('<rect width="32" height="32"');
  expect(html).toContain('<span>inkwell</span>');

  // Favicon uses vector SVG instead of emoji text
  expect(html).toContain('rel="icon"');
  expect(html).toContain('image/svg+xml');
  expect(html).not.toContain('&#9998;');

  // New post button is inside .list-head above post-list
  expect(html).toContain('class="list-head"');
  expect(html).toContain('id="new-post"');
  expect(html).toContain('class="new-btn"');

  // Verify structure: list-head comes before post-list, new-post is in list-head, not sidebar-head
  const listHeadIdx = html.indexOf('class="list-head"');
  const postListIdx = html.indexOf('id="post-list"');
  const newPostIdx = html.indexOf('id="new-post"');
  const searchBoxIdx = html.indexOf('class="search-box"');

  expect(listHeadIdx).toBeGreaterThan(searchBoxIdx);
  expect(postListIdx).toBeGreaterThan(listHeadIdx);
  expect(newPostIdx).toBeGreaterThan(listHeadIdx);
  expect(newPostIdx).toBeLessThan(postListIdx);
});

test("style.css contains styles for brand icon, brand alignment, and list-head controls", async () => {
  const res = await fetch(`${base}/style.css`);
  expect(res.status).toBe(200);
  const css = await res.text();

  expect(css).toContain(".brand-icon");
  expect(css).toContain(".list-head");
  expect(css).toContain(".brand");
  expect(css).toContain("display: inline-flex");
  expect(css).toContain("align-items: center");
});

test("theme tokens, light mode, and theme toggle controls are present", async () => {
  const htmlRes = await fetch(`${base}/index.html`);
  const html = await htmlRes.text();
  expect(html).toContain('id="theme-toggle"');
  expect(html).toContain("inkwell-theme");

  const cssRes = await fetch(`${base}/style.css`);
  const css = await cssRes.text();
  expect(css).toContain("--themes: dark light");
  expect(css).toContain('[data-theme="light"]');

  const jsRes = await fetch(`${base}/app.js`);
  const js = await jsRes.text();
  expect(js).toContain("inkwell-theme");
  expect(js).toContain("availableThemes");
  expect(js).toContain("applyTheme");
});

// ─── FTS5 search (spec: adws/prompts/01-fts5-search.md) ────────────────────

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
  const b = await (await post("/posts", { title: "AND B", content: "zqzqandterm only" })).json();
  const c = await (await post("/posts", { title: "AND C", content: "leap only here" })).json();

  // both words required (AND): a has both, b lacks quantum, c lacks both
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

test("a fresh module's very first request is a search and still uses FTS5", async () => {
  // Seed via the main server so the row exists in the shared INKWELL_DB file.
  const seeded = await (
    await post("/posts", { title: "Seed FTS", content: "zqzqfirstsearch faraway zqzqsecondterm" })
  ).json();

  // A query-string import yields a brand-new module instance: ftsAvailable is
  // false and _db is null, exactly like a fresh server process. Regression for
  // searchPosts() reading ftsAvailable before db() had ever run — under that
  // bug the first request fell into likeSearchPosts, which cannot match the
  // non-adjacent AND terms ("zqzqfirstsearch zqzqsecondterm" is not a
  // contiguous substring), so this test fails without the db() call up front.
  const fresh = await import(`./server.ts?fresh-first-search=${Date.now()}`);
  const srv = Bun.serve({ port: 0, fetch: fresh.handleRequest });
  const b = `http://localhost:${srv.port}`;
  try {
    const res = await fetch(`${b}/api/posts?q=zqzqfirstsearch zqzqsecondterm`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.some((p: { id: number }) => p.id === seeded.id)).toBe(true);
    expect(data[0].snippet).toContain("<mark>");
    expect(typeof data[0].rank).toBe("number");
  } finally {
    srv.stop(true);
    fresh.closeDb();
  }
});

// ─── Revision history (spec: adws/prompts/02-revision-history.md) ─────────

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
  const firstSeeded = (db.query("SELECT id FROM revisions WHERE post_id = ? ORDER BY id LIMIT 1").get(created.id) as { id: number }).id;
  db.close();

  await put(`/posts/${created.id}`, { content: "fresh" }); // appends (newest is old) → 56 → prune
  let rows = revisionsOf(created.id);
  expect(rows.length).toBe(50);
  expect(rows[0].id).toBe(firstSeeded + 6); // six oldest seeded rows pruned
  expect(rows[rows.length - 1].content).toBe("seed"); // newest = the PUT's pre-edit snapshot

  await api(`/posts/${created.id}`, { method: "DELETE" });
  rows = revisionsOf(created.id);
  expect(rows.length).toBe(0); // cascade
});

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
  expect(list[0].word_count).toBe(1); // pre-edit content "two" → one word
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
  // the control lives in the editor footer (last </footer> in the document)
  const footer = html.slice(html.indexOf('<footer class="footer">'), html.lastIndexOf("</footer>"));
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

// ─── Scheduled publishing (spec: adws/prompts/03-scheduled-publishing.md) ──

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
