# Plan: Server-side Markdown rendering with reading time

Source prompt: `adws/prompts/11-markdown-rendering-with-reading-time-for.md`

## Goal

Render post content (Markdown) to safe HTML on the server, add per-post reading time, and expose both through the existing `/api` conventions:

- `GET /api/posts/:id/render` → `{ id, title, html, reading_minutes, word_count, tags }`
- `GET /api/posts` and `GET /api/posts/:id` (plus search results) gain a `reading_minutes` field on every post object.
- Raw user HTML and `javascript:` links must never become live HTML.

All routes live under `/api` in this codebase (see `src/server.ts` `handleApi`); "`GET /posts/...`" in the prompt means `GET /api/posts/...`.

## Files to touch

| File | Change |
|------|--------|
| `package.json`, `bun.lock` | `bun add marked` (real dependency; snyk gate scans it) |
| `src/markdown.ts` | **new** — pure render + reading-time helpers |
| `src/server.ts` | import helpers, add `reading_minutes` to summaries/rows, add `/api/posts/:id/render` route, add `postTags` helper |
| `src/server.test.ts` | new tests below + update 3 existing shape tests |

## Step 1 — add the dependency

Run `bun add marked` (installs latest, currently 18.x; verified working under Bun 1.3.14). This adds a `"dependencies"` entry to `package.json` and updates `bun.lock`.

## Step 2 — new module `src/markdown.ts`

Pure functions, no server imports, exported for direct unit testing:

```ts
import { marked } from "marked";

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Renders markdown to safe HTML: escape the source BEFORE markdown (so raw
 *  HTML like <script> is inert text), then strip dangerous URL schemes from
 *  any href/src marked produced (escape-before-markdown does NOT touch
 *  link destinations, so [x](javascript:alert(1)) would otherwise be live). */
export function renderMarkdown(src: string): string {
  const escaped = escapeHtml(src);
  const html = marked.parse(escaped, { async: false }) as string;
  return html.replace(/(href|src)="(?:javascript|vbscript|data):[^"]*"/gi, '$1="#"');
}

/** words ÷ 200, rounded up to a whole minute, minimum 1. Ceil (not round)
 *  matches the existing /api/posts/:id/stats convention in src/server.ts, so
 *  the app never shows a 250-word post as 1 min in the list and 2 min in stats.
 *  The prompt's examples (short → 1, ~400 → 2) hold under both rules. */
export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}
```

Notes:
- `marked.parse(escaped, { async: false }) as string` — the cast is required; `marked.parse` is typed `string | Promise<string>`.
- Do NOT change the existing `/api/posts/:id/stats` reading-time computation (`wc === 0 ? 0 : Math.ceil(wc / 200)`). Its test pins empty → `reading_minutes: 0`. The new `readingMinutes()` (min 1) is only for render + summaries.

## Step 3 — `src/server.ts`

1. **Import** at the top: `import { renderMarkdown, readingMinutes } from "./markdown.ts";`

2. **`summarize()`** (used by the plain list): add
   `reading_minutes: readingMinutes(wordCount(p.content ?? ""))`.

3. **Search rows** (`searchPosts` map and `likeSearchPosts` map): add the same
   `reading_minutes: readingMinutes(wordCount(content))` field so `GET /api/posts?q=` returns the same shape as the unfiltered list.

4. **Full post `GET /api/posts/:id`** (the `segments.length === 3` GET branch): return
   `json({ ...post, reading_minutes: readingMinutes(wordCount(post.content ?? "")) })` instead of the bare row.

5. **`postTags` helper** (near the `/api/tags` block): extract the per-post tag derivation used by the tags endpoint so the render endpoint can reuse it:
   ```ts
   /** Tags for one post: explicit comma-separated tags column when present,
    *  else hashtags parsed from the title (trailing punctuation stripped). */
   function postTags(title: string | null, explicit: string | null | undefined): string[] { ... }
   ```
   Behavior must match the existing `/api/tags` logic exactly (same split/trim/punctuation rules). Use it in the render endpoint. Refactoring the `/api/tags` loop to call it is optional — do it only if the existing tags tests stay green; otherwise leave that loop untouched.

6. **New route** — insert a block after the `/api/posts/:id/stats` block (same shape):
   ```ts
   // /api/posts/:id/render — server-side markdown → HTML + reading time
   if (segments.length === 4 && segments[3] === "render") {
     if (method !== "GET") return json({ error: "method not allowed" }, 405);
     const post = getPost(id);
     if (!post) return notFound();
     const content = post.content ?? "";
     const wc = wordCount(content);
     return json({
       id: post.id,
       title: post.title,
       html: renderMarkdown(content),
       reading_minutes: readingMinutes(wc),
       word_count: wc,
       tags: postTags(post.title, (post as { tags?: string | null }).tags),
     });
   }
   ```
   (The `tags` column may not exist on the schema — `(post as { tags?: ... }).tags` is `undefined` in that case and `postTags` falls back to title hashtags, matching the `/api/tags` endpoint's behavior.)

## Step 4 — tests (`src/server.test.ts`)

Add tests (append near the stats test; follow existing style — use the shared `post`/`api` helpers). Also add `api(`/posts/${missing}/render`)` to the routes array in the existing "unknown id returns 404 on every route" test.

1. **Markdown renders**: create a post with
   `"# Title\n\nA paragraph with **bold**.\n\n- one\n- two\n\n```\nlet x = 1;\n```\n\n[link](https://example.com)"`,
   `GET /api/posts/:id/render`; assert status 200 and the response keys are exactly
   `["html", "id", "reading_minutes", "tags", "title", "word_count"]`; assert html contains `<h1>Title</h1>`, `<p>`, `<ul>`, `<li>`, `<pre><code>`, and `<a href="https://example.com">`.

2. **Raw HTML escaped**: content `<script>alert(1)</script>`; assert the rendered html does NOT match `<script` (case-insensitive) and DOES contain `&lt;script&gt;`.

3. **`javascript:` link inert**: content `[x](javascript:alert(1))`; assert html does NOT contain `href="javascript:` (case-insensitive; it renders as `<a href="#">` or plain text). Also cover a mixed post containing both `<script>` and a `javascript:` link in one render (prompt's combined safety case).

4. **Reading time**: 1-word post → `reading_minutes: 1`; 400-word post (`Array(400).fill("word").join(" ")`) → `reading_minutes: 2`. Check via the render endpoint and via the list.

5. **404**: `GET /api/posts/999999/render` → `{ error: "not found" }`; `POST /api/posts/:id/render` → 405.

6. **Summaries carry reading_minutes**: the list item, the single-post response, and a search row (`?q=`) each have a numeric `reading_minutes`; list html is still absent (no `html` key in summaries).

**Update these 3 existing tests** (they pin exact key sets and WILL fail otherwise):
- "full lifecycle: create → list → update → publish toggle → delete" — summary keys become `["id", "reading_minutes", "status", "title", "updated_at", "word_count", "target_word_count"]`.
- "search response rows carry exactly snippet and rank beyond the summary keys" — row keys become `["id", "reading_minutes", "status", "title", "updated_at", "word_count", "target_word_count", "snippet", "rank"]`.
- "GET /api/posts/:id includes publish_at; the list summary shape is unchanged" — same summary key update.

## Step 5 — verify (must all pass)

```bash
bun test                 # full suite green (incl. new + updated tests)
bun x tsc --noEmit       # typecheck green
bun build src/server.ts --outdir /tmp/inkwell-build --target bun   # build gate green
snyk test                # snyk gate green — verified: latest marked scans clean
```

The factory gates are exactly these four commands (`adws/adw_sssf_config/sssf.config.yaml`). If `snyk test` ever flags the new dependency, `bun add marked@<patched-version>` and re-run.

## Out of scope (do not touch)

- No frontend/editor changes — `src/public/app.js`'s client-side `renderMarkdown` stays as-is.
- No auth, no schema migration for tags, no markdown extensions beyond marked defaults.
- Do not modify `/api/posts/:id/stats` or the existing stats tests.

## Definition of done

- `GET /api/posts/:id/render` exists per the contract above (404 unknown, 405 non-GET).
- List, single-post, and search responses carry `reading_minutes`.
- `<script>` and `javascript:` never produce live HTML (tests prove it).
- `bun test`, `bun x tsc --noEmit`, `bun build`, and `snyk test` all green.
