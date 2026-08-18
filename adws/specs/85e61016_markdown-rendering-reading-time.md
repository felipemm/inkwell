# Markdown Rendering with Reading Time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side, XSS-safe Markdown rendering (`GET /api/posts/:id/render` → rendered HTML + reading time) and a `reading_minutes` field on every post list/single-post summary.

**Architecture:** Add the `marked` renderer as the only new runtime dependency. Escape all HTML in the post source *before* Markdown parsing (same rule the client-side `renderMarkdown` in `src/public/app.js` already follows), then run `marked.parse` through a custom `SafeRenderer` that (a) drops `javascript:`/`data:`/`vbscript:`/`file:` link and image URLs to inert text, and (b) emits code/codespan content as the already-escaped text so code blocks display correctly instead of being double-escaped. Reading time reuses the exact formula the existing `/api/posts/:id/stats` endpoint already implements (words ÷ 200, ceil, 0 for empty content), extracted into one shared helper. All new routes live under `/api` like every existing route.

**Tech Stack:** Bun (`bun:sqlite`), `marked` ^18 (server-side Markdown), TypeScript strict (`bun x tsc --noEmit`), `bun test` e2e suite against a throwaway `INKWELL_DB`.

**Spec:** `adws/prompts/11-markdown-rendering-with-reading-time-for.md` (a copy is committed at `adws/specs/85e61016_markdown-rendering-reading-time.md`)

## Global Constraints

- **Route prefix:** the spec's `/posts/...`, `/posts`, `/posts/:id` are shorthand for the repo's real `/api/posts/...`, `/api/posts`, `/api/posts/:id`. All existing routes are under `/api`; the new route is `GET /api/posts/:id/render`. Do not add a bare `/posts/...` route.
- **Existing suite must stay green.** Adding `reading_minutes` to plain list summaries breaks exactly two existing tests that assert the summary's exact key set (`src/server.test.ts:92-93` and `src/server.test.ts:1659-1660`) — both must be updated to include `"reading_minutes"`. No other existing test changes.
- **Search rows must NOT gain `reading_minutes`.** The test at `src/server.test.ts:988` asserts the exact search-row key set (`id, status, title, updated_at, word_count, target_word_count, snippet, rank`). `GET /api/posts?q=...` responses keep their current shape — the spec only adds reading time to the plain list and the single post.
- **Reading-time formula:** `words ÷ 200`, rounded up (`Math.ceil`), minimum 1 for any non-empty post; `0` for empty content. This is byte-for-byte the formula `/api/posts/:id/stats` already uses and its existing test asserts (`reading_minutes: 0` for empty). Do NOT change it to `Math.max(1, ...)` — that would break the existing stats test.
- **Safety order:** escape HTML in the source BEFORE Markdown parsing (never after). `<script>` in a post must render as inert text. Marked alone passes raw inline HTML through — the pre-escape is what makes it inert.
- **Link/image allowlist:** only `https:`, `http:`, `mailto:`, `/` (root-relative), `#` (anchor) survive as `href`/`src`. Everything else (`javascript:`, `data:`, `vbscript:`, `file:`, …) renders as inert text with no anchor (`javascript:` links) or is dropped entirely (images). This mirrors the client's allowlist in `src/public/app.js` (`/^(https?:|mailto:|[/#])/i`).
- **`marked` must be a runtime `dependency`** (not `devDependencies`) so the snyk gate scans it.
- No frontend/editor changes, no auth, no custom Markdown extensions beyond the renderer overrides below.
- **You never commit.** The factory owns commits. Report `changed_files` and a `commit_message` in your envelope.

---

### Task 1: Add `marked` and the safe server-side renderer

**Files:**
- Modify: `package.json` (add `marked` to `dependencies`), `bun.lock` (via `bun add`)
- Modify: `src/server.ts` (imports + `escapeHtml` + `SafeRenderer` + exported `renderMarkdown`)
- Test: `src/server.test.ts` (new pure test; reuse the existing `await import("./server.ts")` pattern)

**Interfaces:**
- Produces: `export function renderMarkdown(src: string): string` — safe, full-document HTML from Markdown source. Later tasks call it from the render route.

- [ ] **Step 1: Install the dependency**

Run: `bun add marked`
Expected: exit 0; `package.json` now has `"dependencies": { "marked": "^18.0.9" }` (or newer 18.x) and `bun.lock` records it. Verify with `cat package.json`. Keep it in `dependencies`, not `devDependencies`.

- [ ] **Step 2: Write the failing pure test**

Append to `src/server.test.ts` (inside the new section `// ─── Markdown rendering (spec: adws/specs/85e61016_markdown-rendering-reading-time.md) ───`, placed before the final `});` of the file — actually append after the last existing test):

```ts
test("renderMarkdown escapes raw HTML and drops unsafe link/image URLs (pure)", async () => {
  const { renderMarkdown } = await import("./server.ts");

  // raw <script> never survives as live HTML — it is escaped to inert text
  const html = renderMarkdown("<script>alert(1)</script>");
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("alert(1)");

  // javascript: links render as inert text — no anchor, no scheme in the output
  const evil = renderMarkdown("[x](javascript:alert(1))");
  expect(evil).not.toContain("javascript:");
  expect(evil).not.toContain("<a");

  // safe links still render
  const safe = renderMarkdown("[home](/)\n\n[site](https://example.com)\n\n[mail](mailto:a@b.co)");
  expect(safe).toContain('href="/"');
  expect(safe).toContain('href="https://example.com"');
  expect(safe).toContain('href="mailto:a@b.co"');

  // code blocks are not double-escaped: <div> shows as <div> inside the code block
  const code = renderMarkdown("```\n<div>hi</div>\n```");
  expect(code).toContain("<pre><code>");
  expect(code).toContain("&lt;div&gt;hi&lt;/div&gt;");
  expect(code).not.toContain("&amp;lt;");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — `renderMarkdown is not a function` (server.ts doesn't export it yet).

- [ ] **Step 4: Implement the safe renderer**

In `src/server.ts`, after the `wordCount` helper (near the top, before `getPost`), add:

```ts
// ─── markdown (server-side render) ─────────────────────────────────────────
import { marked, Renderer } from "marked";
import type { Tokens } from "marked";

/** Same escaping rule the client-side renderer uses: escape HTML BEFORE
 *  markdown, so a <script> in a post is inert text, never live HTML. */
const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Only these URL schemes survive as href/src; everything else is inert. */
const SAFE_URL = /^(https?:|mailto:|[/#])/i;

class SafeRenderer extends Renderer {
  link({ href, title, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens);
    if (!SAFE_URL.test(href)) return text; // javascript: etc. → inert text, no anchor
    let safeHref: string;
    try {
      safeHref = escapeHtml(encodeURI(href).replace(/%25/g, "%"));
    } catch {
      return text;
    }
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${safeHref}"${titleAttr}>${text}</a>`;
  }

  image({ href, title, text }: Tokens.Image): string {
    if (!SAFE_URL.test(href)) return ""; // unsafe image → dropped entirely
    let safeHref: string;
    try {
      safeHref = escapeHtml(encodeURI(href).replace(/%25/g, "%"));
    } catch {
      return "";
    }
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${safeHref}" alt="${escapeHtml(text)}"${titleAttr}>`;
  }

  code({ text, lang }: Tokens.Code): string {
    // The whole source was pre-escaped, so token text is already safe HTML.
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    return `<pre><code${cls}>${text}</code></pre>`;
  }

  codespan({ text }: Tokens.Codespan): string {
    return `<code>${text}</code>`;
  }

  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text); // defense in depth — pre-escaping means this never fires
  }
}

const safeRenderer = new SafeRenderer();

/** Renders Markdown to safe, full-document HTML. Export for direct tests. */
export function renderMarkdown(src: string): string {
  const escaped = escapeHtml(src);
  return marked.parse(escaped, { renderer: safeRenderer });
}
```

Note: `import` statements must be at the top of `src/server.ts` (move the two imports above the existing `import { Database } from "bun:sqlite";` line — TypeScript/bun is fine with imports anywhere at module top level, but keep them grouped at the very top for style). The `// ─── markdown ───` section comment can stay next to the helpers.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 6: Typecheck + security scan**

Run: `bun x tsc --noEmit`
Expected: exit 0.

Run: `snyk test`
Expected: exit 0, no vulnerable paths. If snyk flags the `marked` version, pin a patched version: `bun add marked@<patched-version>` and re-run `snyk test` until clean.

---

### Task 2: `reading_minutes` on list summaries and the single post

**Files:**
- Modify: `src/server.ts` (`readingMinutes` helper, `PostSummary` type, `summarize`, `GET /api/posts/:id` response)
- Test: `src/server.test.ts` (new e2e test + update the two existing exact-key assertions)

**Interfaces:**
- Produces: `const readingMinutes = (wc: number): number` — the single source of truth for reading time.
- Produces: `type PostSummary = SummaryRow & { reading_minutes: number }` — the plain-list summary shape.
- Consumes: nothing from Task 1 (independent), but keeps `SummaryRow` and `SearchRow` untouched.

- [ ] **Step 1: Write the failing e2e test**

Append to `src/server.test.ts`:

```ts
test("GET /api/posts and GET /api/posts/:id carry reading_minutes", async () => {
  const created = await (await post("/posts", { title: "RT", content: "one two three" })).json();
  const list = await (await api("/posts")).json();
  const summary = list.find((p: { id: number }) => p.id === created.id);
  expect(summary.reading_minutes).toBe(1);
  expect(summary.word_count).toBe(3);

  const full = await (await api(`/posts/${created.id}`)).json();
  expect(full.reading_minutes).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test`
Expected: FAIL — `summary.reading_minutes` is undefined.

- [ ] **Step 3: Implement the helper and wire it in**

In `src/server.ts`:

1. Right after the `wordCount` helper add:

```ts
/** Estimated reading time: words ÷ 200, rounded up, min 1 for any non-empty
 *  post; 0 for empty content. Same rule the /stats endpoint already used. */
const readingMinutes = (wc: number) => (wc === 0 ? 0 : Math.ceil(wc / 200));
```

2. Change the `SummaryRow` block to introduce `PostSummary` (keep `SummaryRow` itself unchanged — search rows extend it):

```ts
type PostSummary = SummaryRow & { reading_minutes: number };
```

3. Change `summarize` to return `PostSummary`:

```ts
const summarize = (p: Post): PostSummary => ({
  id: p.id,
  title: p.title,
  status: p.status,
  updated_at: p.updated_at,
  word_count: wordCount(p.content ?? ""),
  target_word_count: p.target_word_count ?? 0,
  reading_minutes: readingMinutes(wordCount(p.content ?? "")),
});
```

4. In `GET /api/posts/:id` (`segments.length === 3`, `method === "GET"`), change:

```ts
    if (method === "GET") return json(post);
```

to:

```ts
    if (method === "GET")
      return json({ ...post, reading_minutes: readingMinutes(wordCount(post.content ?? "")) });
```

5. Optionally (behavior-identical refactor), make `/api/posts/:id/stats` use the helper so there is one source of truth — replace its `const readingMinutes = wc === 0 ? 0 : Math.ceil(wc / 200);` line with `const readingMinutesValue = readingMinutes(wc);` and use it in the response. If you do this, keep the response keys exactly `{ word_count, reading_minutes, status }` — the existing stats test asserts that shape and the 0-for-empty behavior.

- [ ] **Step 4: Update the two existing exact-key tests**

In `src/server.test.ts`:

- Test "full lifecycle: create → list → update → publish toggle → delete" (around line 92): add `"reading_minutes"` to the expected keys so it reads:

```ts
  expect(Object.keys(summary).sort()).toEqual(
    ["id", "status", "title", "updated_at", "word_count", "target_word_count", "reading_minutes"].sort(),
  );
```

- Test "GET /api/posts/:id includes publish_at; the list summary shape is unchanged" (around line 1659): same addition:

```ts
  expect(Object.keys(summary).sort()).toEqual(
    ["id", "status", "title", "updated_at", "word_count", "target_word_count", "reading_minutes"].sort(),
  );
```

Do NOT touch the search-row exact-key test at line 988 — search rows stay as they are.

- [ ] **Step 5: Run the suite, typecheck, build**

Run: `bun test`
Expected: PASS (all tests, including the two updated ones).
Run: `bun x tsc --noEmit`
Expected: exit 0.
Run: `bun build src/server.ts --outdir /tmp/inkwell-build --target bun`
Expected: exit 0.

---

### Task 3: `GET /api/posts/:id/render` endpoint with `tags`

**Files:**
- Modify: `src/server.ts` (`postTags` helper, `Post` type, render route in `handleApi`)
- Test: `src/server.test.ts` (e2e tests)

**Interfaces:**
- Consumes: `renderMarkdown` from Task 1, `readingMinutes`/`wordCount` from Task 2, `getPost`, `json`, `notFound`, `db`.
- Produces: `GET /api/posts/:id/render` → `{ id, title, html, reading_minutes, word_count, tags }`; 404 `{ error: "not found" }` for unknown/non-integer ids; 405 `{ error: "method not allowed" }` for non-GET.

- [ ] **Step 1: Write the failing e2e tests**

Append to `src/server.test.ts`:

```ts
test("GET /api/posts/:id/render returns a full rendered document", async () => {
  const md = [
    "# Title",
    "",
    "A paragraph with **bold** and [a link](https://example.com).",
    "",
    "- one",
    "- two",
    "",
    "```",
    "let x = 1;",
    "```",
  ].join("\n");
  const created = await (await post("/posts", { title: "Render Me", content: md })).json();
  const res = await api(`/posts/${created.id}/render`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  const data = await res.json();
  expect(data.id).toBe(created.id);
  expect(data.title).toBe("Render Me");
  expect(data.html).toContain("<h1>Title</h1>");
  expect(data.html).toContain("<strong>bold</strong>");
  expect(data.html).toContain('<a href="https://example.com">a link</a>');
  expect(data.html).toContain("<li>one</li>");
  expect(data.html).toContain("<pre><code>");
  expect(data.html).toContain("let x = 1;");
  expect(typeof data.word_count).toBe("number");
  expect(typeof data.reading_minutes).toBe("number");
  expect(Array.isArray(data.tags)).toBe(true);
});

test("reading time: short post = 1m, ~400 words = 2m, and render carries word_count", async () => {
  const short = await (await post("/posts", { content: "just a few words here" })).json();
  const shortData = await (await api(`/posts/${short.id}/render`)).json();
  expect(shortData.reading_minutes).toBe(1);

  const long = await (await post("/posts", { content: Array(400).fill("word").join(" ") })).json();
  const longData = await (await api(`/posts/${long.id}/render`)).json();
  expect(longData.reading_minutes).toBe(2);
  expect(longData.word_count).toBe(400);
});

test("GET /api/posts/:id/render escapes post HTML — never live HTML", async () => {
  const created = await (
    await post("/posts", { content: "<script>alert(1)</script>\n\n[x](javascript:alert(1))" })
  ).json();
  const data = await (await api(`/posts/${created.id}/render`)).json();
  expect(data.html).not.toContain("<script");
  expect(data.html).not.toContain('href="javascript:');
  expect(data.html).toContain("&lt;script&gt;");
});

test("GET /api/posts/:id/render 404s for an unknown post and 405s for other methods", async () => {
  const created = await (await post("/posts", { title: "R", content: "hi" })).json();

  const missing = await api("/posts/999999/render");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });

  const badId = await api("/posts/abc/render");
  expect(badId.status).toBe(404);

  const badMethod = await post(`/posts/${created.id}/render`);
  expect(badMethod.status).toBe(405);
  expect(await badMethod.json()).toEqual({ error: "method not allowed" });
});

test("GET /api/posts/:id/render returns tags from title hashtags", async () => {
  const created = await (await post("/posts", { title: "Hello #tech #bun", content: "x" })).json();
  const data = await (await api(`/posts/${created.id}/render`)).json();
  expect(data.tags).toEqual(["tech", "bun"]);

  const plain = await (await post("/posts", { title: "Plain", content: "x" })).json();
  const plainData = await (await api(`/posts/${plain.id}/render`)).json();
  expect(plainData.tags).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test`
Expected: FAIL — `/api/posts/999999/render` returns 404 via the trailing `notFound()` fallthrough, but the created-post render test 404s/405s incorrectly (`GET /api/posts/:id/render` currently falls through to `notFound()` for GET, and `post()` on it also 404s). Concretely: `render` route tests fail because the route doesn't exist.

- [ ] **Step 3: Implement `postTags` and the route**

In `src/server.ts`:

1. Add `tags?: string | null;` to the `Post` type (after `updated_at: string;`):

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
  tags?: string | null;
};
```

2. Add a `postTags` helper right after `summarize` — mirrors the `/api/tags` endpoint logic (tags column wins when present and non-empty, else title hashtags with trailing punctuation stripped):

```ts
/** A post's tags: the tags column when present and non-empty, else #hashtags
 *  extracted from the title (same rule as GET /api/tags). */
function postTags(p: Post): string[] {
  const hasTagsColumn = (db().query("PRAGMA table_info(posts)").all() as { name: string }[]).some(
    (col) => col.name === "tags",
  );
  const out = new Set<string>();
  if (hasTagsColumn && typeof p.tags === "string" && p.tags.trim() !== "") {
    for (const raw of p.tags.split(",")) {
      const t = raw.trim();
      if (t) out.add(t);
    }
  } else {
    for (const match of (p.title ?? "").match(/#([^\s#]+)/g) ?? []) {
      const t = match.slice(1).replace(/[.,!?:;'"()\[\]{}]+$/, "").trim();
      if (t) out.add(t);
    }
  }
  return [...out];
}
```

3. Add the route in `handleApi` immediately after the `/api/posts/:id/stats` block (before `/api/posts/:id/revisions`):

```ts
  // /api/posts/:id/render — server-side markdown rendering + reading time
  if (segments.length === 4 && segments[3] === "render") {
    if (method !== "GET") return json({ error: "method not allowed" }, 405);
    const post = getPost(id);
    if (!post) return notFound();
    const wc = wordCount(post.content ?? "");
    return json({
      id: post.id,
      title: post.title,
      html: renderMarkdown(post.content ?? ""),
      reading_minutes: readingMinutes(wc),
      word_count: wc,
      tags: postTags(post),
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test`
Expected: PASS — all new tests plus the full existing suite.

- [ ] **Step 5: Typecheck + build + snyk**

Run: `bun x tsc --noEmit`
Expected: exit 0.
Run: `bun build src/server.ts --outdir /tmp/inkwell-build --target bun`
Expected: exit 0.
Run: `snyk test`
Expected: exit 0.

---

### Task 4: Full verification

- [ ] **Step 1: Run every gate command**

```bash
bun test
bun x tsc --noEmit
bun build src/server.ts --outdir /tmp/inkwell-build --target bun
snyk test
```

Expected: every command exits 0. Judge by exit status, not by scanning output for the word "error".

- [ ] **Step 2: Report**

Report `changed_files`: `src/server.ts`, `src/server.test.ts`, `package.json`, `bun.lock`. Suggest commit message: `feat: server-side markdown rendering with reading time`.

## Self-Review (planner-side, already done)

- Spec coverage: markdown rendering ✓ (Task 1), reading time ✓ (Task 2/3), render API ✓ (Task 3), list/single `reading_minutes` ✓ (Task 2), safety (`<script>` + `javascript:`) ✓ (Task 1 pure test + Task 3 e2e), 404 ✓, typecheck + snyk ✓ (Task 4).
- Placeholder scan: no TBD/TODO; every code step carries the exact implementation.
- Type consistency: `renderMarkdown` (Task 1) is used by the route (Task 3); `readingMinutes` (Task 2) is used by summarize, single-post GET, and the render route; `PostSummary` only affects the plain list; `SearchRow`/search mapping untouched so the line-988 test stays green.
