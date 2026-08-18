# Markdown rendering with reading time for posts

Posts are written in Markdown — render them beautifully on the wire.

## What to build

1. **Server-side Markdown rendering.** Add a maintained Markdown renderer (e.g. `marked` — a real dependency, so the snyk gate scans it) and render a post's content to HTML safely. Never render raw user HTML: escape HTML in the source BEFORE markdown (or use a sanitizer), so `<script>` in a post can never execute.
2. **Reading time.** Each post gets an estimated reading time: words ÷ 200, rounded to whole minutes, min 1. Words are whitespace-separated (same rule as the revision word counts).
3. **API.**
   - `GET /posts/:id/render` → `{ id, title, html, reading_minutes, word_count, tags }` — the rendered HTML (full document: `<h1>`…`<p>`, lists, code blocks, links) + reading time. 404 for an unknown post.
   - `GET /posts` and `GET /posts/:id` gain a `reading_minutes` field on each post summary (no HTML in the list — summaries stay plain text).
   - Follow the existing src/server.ts conventions: status codes, error bodies, helpers.
4. **Safety.** A post whose content contains an HTML tag or a `javascript:` link renders as inert text — add a test that proves `<script>alert(1)</script>` and `[x](javascript:alert(1))` never produce live HTML.

## Tests (bun test — the suite must stay green)

- a markdown post renders: heading, paragraph, list, code block, link
- raw HTML in the post is escaped, never passed through
- reading time: short post = 1m, ~400 words = 2m
- render endpoint 404s for an unknown post
- list/summary carries reading_minutes
- typecheck passes (bun x tsc --noEmit) and the snyk gate stays green

## Out of scope

- No frontend/editor changes, no auth, no custom markdown extensions beyond the renderer's defaults.

## Definition of done

The endpoints above exist with tests, `bun test` + `bun x tsc --noEmit` are green, and the snyk scan of the new dependency is clean (or pinned to a patched version if the scan flags anything). Follow src/server.ts's existing conventions.

---
Generated from internal ticket  ()
