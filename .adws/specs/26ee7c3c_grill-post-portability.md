# Grill plan: post portability

## Decisions fixed by review

- No ADR directory or `CONTEXT.md` exists in this checkout; the implementation must follow the ticket and the existing `posts` schema.
- Keep portability at the HTTP boundary in `src/server.ts`; do not alter tables, revisions, FTS, or introduce a YAML dependency.
- Treat JSON export as a snapshot of `SELECT * FROM posts` in deterministic `id ASC` order. Emit `{ version: 1, exported_at: now(), posts }`; each item is the complete current `Post` row, including source `id` and `publish_at`.
- Import is append-only. Source `id` is ignored. Each accepted item gets SQLite’s new autoincrement id and no revision rows. Import must preserve supplied portable fields (`title`, `content`, `status`, `target_word_count`, `publish_at`, `created_at`, `updated_at`) when valid/present; generated timestamps fill absent JSON timestamps. This resolves the otherwise conflicting “full row” bundle versus “new ids” rule.
- Markdown intentionally represents only the five specified metadata fields. Its serializer emits LF-only bytes: opening delimiter at byte zero; flat `key: value` header lines for `title`, `status`, `created_at`, `updated_at`, `target_word_count`; closing delimiter; one blank line; then the content without any transformation. A title’s value is everything after the first `:` (optionally following the one serializer-added space), so embedded colons and Unicode survive.
- Parsing recognizes front matter only when the very first bytes form the opening delimiter line. Find the matching closing delimiter as a whole line, parse only the header region with a first-colon split, and take every byte after the required blank separator as body. Do not scan/reinterpret later `---` lines (including fenced-code content). Missing opener, missing closer, invalid flat header syntax, or a missing required blank separator is malformed markdown. Header unknowns may be ignored; only flat scalar values are supported.
- Apply the same defaults as `POST /api/posts` for missing markdown fields: `title: "Untitled"`, `status: "draft"`, `target_word_count: 0`; absent content is `""`. Validate target count as a non-negative finite number and floor it, falling back to zero; reject invalid bundle envelope structure/version rather than partially importing it. Use a transaction so a valid bundle either inserts all posts in input order or none.
- Status is imported as portable data (not recomputed); scheduled `publish_at` is retained in JSON bundles because it is a full-row format. Markdown has no `publish_at`, so a markdown-imported scheduled status has `publish_at: null`; no silent status conversion. `created_at`/`updated_at` from markdown are retained if present, otherwise receive insertion-time timestamps.
- Route matching must handle top-level `/api/export` and `/api/import` before the existing `/api/posts` gate; `/api/posts/:id/export` must be handled before the generic post route. Content type comparisons accept parameters (e.g. charset) and dispatch only `text/markdown` and `application/json`; unsupported types return the existing JSON error convention with 400.
- UI downloads are browser-only `Blob` plus `URL.createObjectURL`, programmatically clicked anchors, then object-URL cleanup. Before exporting the current post, flush autosave so exported bytes match the visible editor. File import reads the selected file as text, chooses MIME from `.md` versus `.json` (with a safe fallback), posts raw bytes to `/api/import`, clears the input so re-importing the same file works, refreshes the unfiltered list, and selects an imported post (first returned id) to make arrival visible. Failures must be caught without corrupting local editor state.

## Implementation plan

1. **`src/server.ts` — isolate portable-format helpers and row insertion.**
   - Add a typed importable-post shape and helpers for: Markdown front-matter serialization; strict first-block parsing; content-type normalization; validating/normalizing JSON bundle envelopes; and inserting a newly allocated post from normalized data.
   - Serialize exact markdown with the required field order and blank line. Ensure no title/content escaping or body newline normalization occurs; `---` in the body remains ordinary content.
   - Use prepared inserts that omit source `id`; preserve valid source lifecycle/timestamp fields, use established create defaults where data is absent, and return the generated ids in insertion order. Do not call the existing POST endpoint internally or create revision history.
   - Add `GET /api/posts/:id/export`: locate post, return `notFound()` for unknown/noninteger ids, otherwise return Markdown with `content-type: text/markdown` and an attachment `Content-Disposition` filename built from a Unicode-safe lowercase slug (fallback `untitled`) plus `.md`. The slug must not permit header injection or path separators.
   - Add `GET /api/export`: query complete post rows ordered by id ascending and respond as JSON `{ version: 1, exported_at, posts }`.
   - Add `POST /api/import`: route by media type. Markdown accepts exactly one parsed document and returns `201 { imported: 1, ids: [id] }`. JSON requires an object with `version === 1` and `posts` as an array, normalizes each row and transactionally appends them, returning `201 { imported: n, ids }` in source order. Reject malformed markdown, malformed JSON/envelope, wrong version, and non-array posts with `400 { error: ... }`; retain the existing malformed-JSON catch behavior.
   - Preserve existing route/method behavior and static serving. Do not make imports overwrite posts, query by title/id, write files, or change SQLite schema.

2. **`src/public/index.html` and `src/public/style.css` — expose compact, accessible portability controls.**
   - Put `export all` and an import trigger/file input in the sidebar footer alongside the post count. Configure the hidden/visually-contained file input to accept `.md,.json,text/markdown,application/json`, associate it with an accessible import button/label, and retain keyboard access.
   - Put an `export` button in the editor footer with the existing schedule/history controls; it operates on the active post and is inert/disabled when none is selected.
   - Extend sidebar/footer control styling using current design tokens and existing `.btn` conventions. Avoid adding a visual persistence mechanism, drag/drop, or filesystem-related UI.

3. **`src/public/app.js` — wire raw import and Blob export into current save/list lifecycle.**
   - Add DOM references for the three controls and helper(s) to download response text/JSON through Blob/object URLs, deriving the single-post filename from `Content-Disposition` when available and using a stable bundle fallback filename.
   - Wire current export to `flushSave()`, fetch `/api/posts/${current.id}/export`, verify response success, then download its raw Markdown text with the response MIME type.
   - Wire export-all to fetch `/api/export`, serialize/download its response as JSON without disk writes or shell commands.
   - On file selection, read text with `File.text()`, select `text/markdown` for `.md` and `application/json` for `.json`, POST raw content to `/api/import`, then clear search/query state and reload `/api/posts`. Render the refreshed list, select the first returned imported id when present, update counts, and surface failures via the existing save-state/console pattern. Ensure no generic JSON `api()` helper is used for the raw upload.

4. **`src/server.test.ts` — add end-to-end portability coverage without weakening existing tests.**
   - Add helpers for raw imports and response/header inspection.
   - Verify single Markdown export status, `text/markdown` type, attachment filename/slug, exact required front matter and separator, and `404 { error: "not found" }` for a nonexistent id.
   - Create a post whose title has a colon and non-ASCII text and whose body includes a bare `---`, fenced code block, Unicode, colons, and a trailing newline; export then import the exact response text and assert new id, independent row, and equality of title/content/status/target count. Import it twice and prove two distinct new ids/rows.
   - Cover Markdown defaults for omitted title/status/target fields and malformed no-opener/unterminated cases (plus invalid flat header/separator if implemented as strict validation), each returning a 400 JSON error.
   - Verify all-post bundle export has JSON media type, `version: 1`, an `exported_at` value, and complete post rows in deterministic order. Import that exact bundle and assert response id order, fresh ids, row-field fidelity (including status/timestamps/publish time as applicable), and source rows remain unchanged.
   - Verify malformed bundle JSON, wrong version, and non-array `posts` return 400 errors; include an invalid member case to prove the transaction does not leave partial imported rows. Keep all numbered ticket behaviors covered and run `bun test src/server.test.ts`.

5. **Verification.**
   - Run `bun test src/server.test.ts`; it must pass.
   - Manually exercise the served UI: create/edit a post, export current, export all, import each downloaded file, confirm duplicate imports create additional rows, and confirm the list refreshes/selects the imported post. Inspect browser downloads to confirm Blob/object URLs and expected `.md`/`.json` names.
