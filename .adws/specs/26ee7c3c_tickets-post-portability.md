# Post portability implementation tickets

## Build portable server API and tests

Implement `src/server.ts` Markdown serialization/parsing, safe filenames, `GET /api/posts/:id/export`, `GET /api/export`, and append-only `POST /api/import` for Markdown and version-1 JSON bundles. Preserve schema and all unrelated routes. Add `src/server.test.ts` coverage for each API requirement: exact Markdown format, high-risk round trip/trailing newline, duplicate imports/fresh ids, defaults, malformed input, full ordered bundle export, bundle field retention/order, and atomic invalid-bundle rejection.

### Acceptance criteria

- Markdown and bundle exports meet requested status, media type, body, order, and error contracts.
- Imports create only new rows, preserve required portable values, and JSON bundle imports are all-or-nothing.
- Parser only considers the opening block at byte zero, retains colon-containing values/body bytes, and applies specified defaults.
- `bun test src/server.test.ts` passes with all previous tests still green.

## Add portability browser controls

Implement export-current, export-all, and file-import UI in `src/public/index.html`, `src/public/style.css`, and `src/public/app.js`. Use accessible controls, Blob/object URL downloads, raw-content import requests, and post-import unfiltered list refresh/selection. Add static UI contract tests in `src/server.test.ts` for controls, accepted file types, download mechanism, import content types, and refresh wiring.

### Acceptance criteria

- Editor footer exposes current Markdown export; sidebar footer exposes bundle export and usable `.md`/`.json` import input.
- Downloads use `Blob` and `URL.createObjectURL`, not filesystem APIs.
- Import posts raw text as correct MIME, permits identical-file reimport, refreshes list/search state, and does not discard active editor state on failure.
- `bun test src/server.test.ts` passes.
