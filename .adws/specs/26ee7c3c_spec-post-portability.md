# Make Inkwell posts portable

## Goal

Add append-only Markdown and JSON post portability without changing the SQLite schema, storage model, revisions, or search. Writers can download one post as Markdown, download all posts as a versioned JSON bundle, and import either format from the UI.

## Scope and fixed format decisions

- Implement only `src/server.ts`, `src/public/index.html`, `src/public/app.js`, `src/public/style.css`, and `src/server.test.ts`. No dependencies, shell-outs, or non-database filesystem writes.
- JSON bundle format is `{ version: 1, exported_at: string, posts: Post[] }`, where export queries `SELECT * FROM posts ORDER BY id ASC`; thus it includes the full stored row, source `id`, `publish_at`, timestamps, and other current table columns.
- JSON imports are append-only: ignore every source `id`, allocate SQLite ids, preserve recognized stored fields (`title`, `content`, `status`, `target_word_count`, `publish_at`, `created_at`, `updated_at`) when present/valid, and do not make revisions. Insert all bundle rows in a transaction in input order; on validation failure insert none.
- Single-post Markdown uses LF bytes and exactly this header order:
  ```text
  ---
  title: <title>
  status: <status>
  created_at: <created_at>
  updated_at: <updated_at>
  target_word_count: <target_word_count>
  ---

  <content verbatim>
  ```
  The serializer performs no body escaping or newline normalization. Concatenating the separator and original content preserves a trailing content newline exactly.
- The hand-written parser recognizes front matter only when `---` is the first delimiter line at byte zero. It finds the matching closing delimiter line, splits each flat header at its first `:` only, and treats bytes after the mandatory blank separator as content. A later bare `---`, including one in a fenced block, is ordinary body text. Values after the first colon are retained, so titles/values containing colons and Unicode round-trip.
- Reject Markdown lacking the first block, closing delimiter, valid flat `key: value` header lines, or mandatory blank separator with `400 { error: ... }`. Ignore unknown flat keys. Missing Markdown `title`, `status`, and `target_word_count` use the current POST defaults: `Untitled`, `draft`, and `0`; content defaults to `""`.
- Normalize imported target count as POST does: a finite non-negative number, floored; otherwise default zero. Preserve imported status/timestamps when supplied as strings so a normal export/import round trip is faithful. Markdown omits `publish_at`, so its import stores `publish_at: null`.
- Dispatch import by normalized Content-Type (ignore parameters): support only `text/markdown` and `application/json`; unsupported media types return a JSON 400. Invalid JSON retains the existing malformed-JSON 400 behavior. Wrong JSON version or a non-array `posts` is a 400.

## Implementation

### 1. `src/server.ts`: portable serializers, parsers, insertion, and routes

1. Add local helpers/types near the response/body helpers:
   - Markdown serializer for a `Post`.
   - Strict first-front-matter parser returning normalized portable post data or throwing a validation error.
   - Content-Type normalization (`header.split(";", 1)[0].trim().toLowerCase()`).
   - JSON bundle envelope validation and per-row normalization.
   - A single insert helper that omits source ids, uses generated timestamps where absent, and returns its generated id. It must not reuse POST routing logic or create revisions.
2. Add top-level API route handling before the existing `segments[1] !== "posts"` guard:
   - `GET /api/export`: return JSON `{ version: 1, exported_at: now(), posts }`, with full rows in `id ASC` order; non-GET gets existing 405 shape.
   - `POST /api/import`: read raw request text. For Markdown, parse exactly one document and insert one new row. For JSON, parse/validate version `1` and `posts` array, then transactionally insert each item. Return 201 `{ imported, ids }`; ids must follow source array order. Never match/update by title/id.
3. Add `GET /api/posts/:id/export` before the generic single-post endpoint. Look up the post and return `notFound()` for unknown/noninteger ids. On success, return serialized Markdown with `content-type: text/markdown` and `Content-Disposition: attachment; filename="<safe-slug>.md"`.
   - Generate a deterministic lowercase filename slug from the title; remove/control unsafe characters and path separators, collapse separators, and fall back to `untitled`. Ensure no title can inject HTTP headers.
4. Leave existing posts CRUD, scheduled behavior, revisions, FTS, static service, and SQLite schema unchanged. Ensure route ordering does not reinterpret `export` as a numeric post id.

### 2. `src/public/index.html` and `src/public/style.css`: controls

1. Add an **export** button to the editor footer for the active post.
2. Add **export all** plus an import trigger and file input to the sidebar footer. The input accepts `.md,.json,text/markdown,application/json`; make the trigger keyboard-accessible and the input visually hidden without making it unusable.
3. Style the new sidebar/footer controls with existing design tokens and `.btn`/meta conventions. Preserve compact footer layout and no drag/drop or backup UI.

### 3. `src/public/app.js`: downloads, raw uploads, and refresh

1. Add UI references for single export, bundle export, and import input/trigger.
2. Implement a browser-only download helper: construct a `Blob`, create an object URL, click a temporary anchor with `download`, then revoke/remove it. Never use filesystem APIs.
3. On current-post export, call `flushSave()` first, fetch `/api/posts/${current.id}/export`, use the response Markdown bytes/text and MIME type, and obtain the filename from a safe `Content-Disposition` filename when available (with a `.md` fallback).
4. On export-all, fetch `/api/export`, download the JSON payload as a Blob with an `.json` bundle name. Handle non-OK responses consistently with current UI error handling.
5. On import selection, read `File.text()`, select Markdown/JSON MIME based on `.md`/`.json` extension (safe fallback for unknown), and send raw text with `fetch('/api/import', { method: 'POST', headers: { 'Content-Type': ... }, body: text })`; do not use the JSON-only `api()` helper.
6. On successful import, clear the file input (so the same file can be imported twice), clear active search/query state, reload unfiltered `/api/posts`, rerender, and select the first returned imported id if any. On failure, leave the active editor data intact and report with the existing save-state/console style.

### 4. `src/server.test.ts`: end-to-end portability tests

Add API helpers for raw body imports and response/header assertions. Keep all existing tests and add coverage for every requested behavior:

1. Single Markdown export: 200, `text/markdown`, attachment `.md` slug, required ordered delimiter/header/separator format, and unknown id `404 { error: "not found" }`.
2. Markdown round-trip with a colon-containing non-ASCII title and content containing a bare `---` line, fenced code, colons, Unicode, and a trailing newline. Export exact bytes, import them, and prove a fresh id plus equality of title/content/status/target count. Import identical bytes twice and prove independent new ids/rows.
3. Markdown defaults for omitted title/status/target fields, and 400 errors for no front matter and unterminated front matter (also test invalid header/separator if parser makes them strict).
4. Bundle export: 200 JSON, `version: 1`, valid `exported_at`, full complete post rows, deterministic `id ASC` order.
5. Bundle import: import an exported bundle, verify 201 count and source-order ids, all fresh ids, original source rows unchanged, and imported recognized row fields including status, timestamps, and `publish_at` retained.
6. Error cases: malformed JSON, wrong version, `posts` not an array, and an invalid member. Assert 400 error shapes and that the invalid bundle transaction adds no partial posts.
7. Add static/UI contract checks that controls, accepted extensions, Blob/object URL download behavior, raw import Content-Type handling, and list refresh wiring exist, while relying on server tests for API behavior.

## Verification

1. Run `bun test src/server.test.ts`; it must exit successfully.
2. Manually run the app: create/edit a post, export its Markdown and the JSON bundle, import each, import one twice, and confirm duplicate append-only rows plus list refresh/selection.
3. Confirm the Markdown round-trip retains a trailing newline and body `---`; confirm downloaded files use Blob/object URLs and `.md`/`.json` names.
