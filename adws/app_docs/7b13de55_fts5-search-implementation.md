The Inkwell application now includes a robust full-text search (FTS5) implementation, significantly enhancing the discoverability of content compared to the previous `LIKE '%term%'` approach. This feature is crucial for writers with many drafts, allowing them to quickly find specific content and rank results by relevance.

**What changed and why it matters:**
The core change is the integration of SQLite FTS5 to provide efficient and ranked full-text search capabilities. This moves beyond simple substring matching to offer a more intelligent search experience.
-   **Server-side:** `src/server.ts` now manages an FTS5 virtual table (`posts_fts`) over `title` and `content`. This includes idempotent creation and backfilling upon database open, as well as automatic indexing updates via `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers on the `posts` table. The `GET /api/posts` endpoint has been updated to accept `q` or `search` parameters, processing queries through FTS5, ranking results, and generating HTML-marked snippets. A robust fallback to `LIKE` search is implemented if FTS5 is unavailable or a query is malformed, ensuring consistent API response shapes.
-   **Client-side:** `src/public/app.js` now includes a `renderSnippet` function to safely render the highlighted search snippets received from the server, escaping all HTML except the `<mark>` tags. The `renderList` function integrates these snippets into the displayed search results.
-   **Styling:** `src/public/style.css` provides new styles for `.post-snippet` to control its layout and `.post-snippet mark` for visual highlighting.
-   **Tests:** `src/server.test.ts` has been extensively updated with new tests covering database migration, FTS5 trigger functionality, the exact shape and content of search results (including `snippet` and `rank`), search ordering by relevance, multi-word query logic, handling of hostile inputs, and client-side rendering of snippets with proper HTML escaping.

**Files that carry it:**
-   `src/server.ts`: Implements FTS5 index management, query parsing, search execution (FTS5 and LIKE fallback), and result shaping.
-   `src/server.test.ts`: Contains new tests validating all aspects of the FTS5 search.
-   `src/public/app.js`: Adds client-side logic for rendering search result snippets.
-   `src/public/style.css`: Defines CSS rules for search result snippets and highlights.

**How to use or verify it:**
-   **Usage:**
    -   To search, use `GET /api/posts?q=<your_query>` or `GET /api/posts?search=<your_query>`.
    -   The server returns posts that match the query, ordered by relevance. Each search result object will include `snippet` (a string containing the matched text with `<mark>` HTML tags) and a numeric `rank`.
    -   An empty or whitespace-only query will return the complete, unfiltered list of posts, maintaining their original summary shape (without `snippet` and `rank`).
-   **Verification:**
    1.  Run the full test suite using `bun test` to ensure all existing and new tests pass, confirming both server-side logic and client-side rendering.
    2.  Start the Inkwell server: `bun run src/server.ts &`.
    3.  Use `curl` to manually test the API:
        -   `curl -s 'http://localhost:4501/api/posts'` to verify the unfiltered list.
        -   `curl -s 'http://localhost:4501/api/posts?q=your_term'` to check search results, snippets, and ranking.
        -   Test with multi-word queries, e.g., `curl -s 'http://localhost:4501/api/posts?q=first%20second'`.
        -   Test hostile inputs like `curl -s 'http://localhost:4501/api/posts?q=%22'` or `curl -s 'http://localhost:4501/api/posts?q=*'` to confirm they return `200` with an empty array.
    4.  Observe the Inkwell web interface to confirm that search queries correctly display results with highlighted snippets.