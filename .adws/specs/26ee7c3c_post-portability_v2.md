# Make Inkwell posts portable

## Scope

Touch only `src/server.ts`, `src/public/index.html`, `src/public/app.js`, `src/public/style.css`, and `src/server.test.ts`. Preserve SQLite schema, CRUD, FTS, scheduled posts, revisions, and existing UI behavior. Use Bun/bun:sqlite and vanilla browser APIs only.

## Implementation plan

### 1. Add portable server helpers in `src/server.ts`

- Extend the local post/import types near `Post` and the existing response/body helpers; do not migrate the database.
- Add a deterministic Markdown serializer for one `Post` with exactly this LF-delimited front matter order:
  ```text
  ---
  title: <title>
  status: <status>
  created_at: <created_at>
  updated_at: <updated_at>
  target_word_count: <target_word_count>
  ---

  <content>
  ```
  Concatenate the separator and stored body rather than trimming or normalizing the body, so a body trailing newline is retained exactly.
- Hand-write a flat front-matter parser. It must recognize front matter only when the opening `---` delimiter is at byte zero and the closing delimiter is a later complete delimiter line. Split header lines on their first colon only; retain all text after that colon, including further colons and Unicode. Require one blank separator after the closing delimiter before body bytes. Treat every later `---`, including one inside a fenced code block, as body content. Reject missing/open-only front matter, malformed flat header lines, and missing separator with a validation error. Ignore unknown keys.
- Normalize Markdown fields: string `title` defaults to `Untitled`; string `status` defaults to `draft`; finite non-negative numeric `target_word_count` is floored, otherwise `0`; absent body is `""`. Preserve supplied string `created_at`/`updated_at`; Markdown has no `publish_at`, so insert `null`.
- Add reusable JSON-bundle validation: JSON top level must be an object with exactly supported `version: 1` semantics and `posts` an array; normalize each input row without trusting its `id`. Carry supported stored fields (`title`, `content`, `status`, `target_word_count`, `publish_at`, `created_at`, `updated_at`) and apply POST-compatible defaults to missing/invalid fields. Reject an invalid row before writing anything.
- Add one insert helper that omits source ids, assigns `now()` for missing timestamps, does not snapshot revisions, and returns generated ids. Use a SQLite transaction for JSON imports so failed validation/insertion leaves no partial bundle. Insertion order and returned id order must match bundle order.
- Add a safe deterministic title slug helper for attachment names: lowercase title, remove/control path/header unsafe bytes, collapse separators, fall back to `untitled`, and append `.md`.

### 2. Add API routes in `src/server.ts`

- Before the `posts` route guard, implement `GET /api/export`: query `SELECT * FROM posts ORDER BY id ASC` and return `{ version: 1, exported_at: now(), posts }` as JSON. Return existing `405 {error:"method not allowed"}` for other methods.
- Before the generic numeric single-post route, implement `GET /api/posts/:id/export`. Return existing not-found JSON for noninteger/missing ids. Return serialized Markdown with `content-type: text/markdown` and `content-disposition: attachment; filename="<slug>.md"`.
- Before the `posts` route guard, implement `POST /api/import`, dispatching by normalized media type (lowercase portion before `;`):
  - `text/markdown`: consume raw text, parse one document, append one post, respond `201 { imported: 1, ids: [id] }`.
  - `application/json`: consume/parse raw JSON, validate bundle/rows before transaction, append all rows, respond `201 { imported: n, ids: [...] }`.
  - Other methods retain 405; unsupported content type and validation failures return `400 { error: <message> }`; malformed JSON continues to use the existing malformed-JSON 400 handling.
- Never match or overwrite by source id or title. Repeating either import always creates independent rows.

### 3. Add portability controls and client behavior

#### `src/public/index.html`

- Add an editor-footer button for exporting the selected post.
- In the sidebar footer, retain the post count and add Export all plus an accessible Import trigger bound to a visually hidden file input. The input must accept `.md,.json,text/markdown,application/json` and stay usable from keyboard/button activation.

#### `src/public/style.css`

- Add compact sidebar-footer action layout and hidden-file-input styles using current tokens, `.btn`, and focus-visible conventions. Ensure new controls do not disrupt existing drawer/footer spacing.

#### `src/public/app.js`

- Add UI references and event handlers for individual export, bundle export, import trigger, and file input.
- Add a browser download helper that uses `Blob`, `URL.createObjectURL`, a temporary anchor’s `download` property/click, and URL revocation/removal. Do not use filesystem APIs.
- Current-post export must `await flushSave()`, fetch `/api/posts/${current.id}/export`, check response status, use returned Markdown and MIME, and select a safe filename from `Content-Disposition` with an `.md` fallback.
- Bundle export must fetch `/api/export`, check status, and download the response as a JSON Blob with an `.json` filename.
- File import must read `File.text()`, select `text/markdown` or `application/json` from `.md`/`.json` extension (safe fallback for unknown), and post raw text to `/api/import`; do not send through the JSON-only `api()` wrapper.
- After a successful import, clear the input (enabling re-import of the identical file), clear search input/query and clear control state, refetch unfiltered `/api/posts`, rerender the list, then select the first returned imported id if present. On failure, retain current editor data and use current console/save-state error conventions.

### 4. Expand `src/server.test.ts`

- Add helpers for raw import requests and response header/body assertions without weakening existing tests.
- Cover single Markdown export: successful MIME, ordered front-matter text, blank separator, safe `.md` attachment filename, and unknown-id 404 shape.
- Prove the specified high-risk Markdown round trip: colon title, non-ASCII text, a body bare `---`, fenced code, colons, and a trailing newline. Export bytes, import exact bytes, then assert new id and equality of title/content/status/target count. Import exact bytes again and assert another independent id/row.
- Cover Markdown defaults for absent `title`, `status`, and target count; 400 error objects for missing and unterminated front matter (plus malformed header/separation where applicable).
- Cover JSON bundle export contract: MIME, version, parseable export timestamp, full stored rows, and ascending source id ordering.
- Cover JSON bundle import: imported count/ordered ids, fresh generated ids, no changes to source posts, retention of supported fields including status/timestamps/`publish_at`, wrong version, non-array `posts`, malformed JSON, invalid member, and transaction rollback/no partial import.
- Add static client-contract assertions for controls/accept string, Blob/object URL path, raw content-type import path, and unfiltered list refresh. Keep server behavior assertions end-to-end.

## Verification

1. Run `bun test src/server.test.ts`; require exit status 0.
2. Run the app and manually create/edit a post, export one Markdown file and all-post JSON bundle, import both, then import the same file again. Confirm appended duplicate rows, correct selected imported row/list refresh, and no overwritten original.
3. Inspect exported/imported Markdown for exact trailing newline retention and body `---`; verify browser downloads use Blob/object URLs and `.md`/`.json` names.

## Ticket sequencing

1. Implement server serializer/parser/import/export routes and API tests together, keeping append-only transaction semantics.
2. Implement HTML/CSS/JS controls and static UI assertions after API contracts are available.
3. Run the complete targeted suite and resolve integration failures without unrelated changes.
