### Markdown Rendering with Reading Time

This change introduces server-side Markdown rendering with reading time calculation for post content, enhancing how post details are presented and accessed through the API. The `marked` library is used for Markdown processing, ensuring safety by escaping raw HTML and neutralizing `javascript:` links.

**What changed:**

-   **New Markdown and Reading Time Utilities:** A new file, `src/markdown.ts`, was added. It exports `renderMarkdown` to convert Markdown to safe HTML (escaping `<script>` tags and neutralizing `javascript:` links) and `readingMinutes` to calculate the estimated reading time (words divided by 200, rounded up, minimum 1 minute).
-   **New API Endpoint:** A `GET /api/posts/:id/render` endpoint was introduced. This endpoint returns the `id`, `title`, rendered `html`, calculated `reading_minutes`, `word_count`, and `tags` for a given post.
-   **Reading Time in Existing Endpoints:** The `reading_minutes` field is now included in the responses from `GET /api/posts` (list summary), `GET /api/posts/:id` (single post detail), and `GET /api/posts?q=<query>` (search results).
-   **Tag Extraction Refactoring:** The logic for deriving post tags (from an explicit `tags` column or hashtags in the title) was extracted into a reusable `postTags` helper function in `src/server.ts`. This helper is used by the new `/render` endpoint and the existing `/api/tags` endpoint.
-   **Dependencies and Tests:** The `marked` library was added as a dependency in `package.json` and `bun.lock`. Comprehensive tests were added/updated in `src/server.test.ts` to verify markdown rendering, HTML safety, correct reading time calculations, and the behavior of the new and updated API endpoints.

**Why it matters:**

This update provides rich, server-rendered content suitable for display, along with a useful reading time estimate, directly from the API. It also reinforces security by preventing XSS vulnerabilities from user-submitted Markdown content.

**Files changed:**

-   `bun.lock`
-   `package.json`
-   `src/markdown.ts`
-   `src/server.test.ts`
-   `src/server.ts`

**How to use or verify:**

-   **To get rendered HTML and reading time:** Make a `GET` request to `/api/posts/:id/render`. For example, `GET /api/posts/123/render`.
-   **To see reading time in post summaries:** Make `GET` requests to `/api/posts`, `/api/posts/123`, or `/api/posts?q=searchterm` and observe the new `reading_minutes` field in the JSON responses.
-   **To verify safety and functionality:** Run `bun test`, `bun x tsc --noEmit`, `bun build src/server.ts --outdir /tmp/inkwell-build --target bun`, and `snyk test`. All should pass.