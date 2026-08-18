The Inkwell application now features a comprehensive revision history system, enabling writers to track changes to their posts, review past versions, and restore content. This enhancement provides a safety net and improved content management for authors.

**What changed and why it matters:**
The core change introduces a revision history mechanism to Inkwell. Every significant save or state change of a post now creates a snapshot, which can be reviewed and reverted.

*   **Server-side (`src/server.ts`):**
    *   A new `revisions` SQLite table has been added to store post snapshots, including `id`, `post_id`, `title`, `content`, `word_count`, `reason` (e.g., 'edit', 'publish', 'restore'), and `created_at`.
    *   The `snapshotPost` helper function manages the creation, coalescing, and pruning of revisions. 'Edit' revisions made within 60 seconds of each other are coalesced (overwritten), preventing a flood of minor revisions during continuous writing. Revisions for 'publish', 'unpublish', and 'restore' actions are always appended.
    *   Only the 50 most recent revisions are retained per post, with older revisions automatically pruned.
    *   The `PUT /api/posts/:id` endpoint now triggers a snapshot of the post's *pre-edit* state if the `title` or `content` has changed.
    *   Publish/unpublish actions (`POST /api/posts/:id/publish`) also snapshot the post's state with an appropriate reason.
    *   Deleting a post (`DELETE /api/posts/:id`) now cascades and removes all associated revisions.
    *   New API endpoints were introduced:
        *   `GET /api/posts/:id/revisions`: Lists summary information for all revisions of a post, ordered newest first.
        *   `GET /api/posts/:id/revisions/:rev`: Retrieves the full content of a specific revision.
        *   `GET /api/posts/:id/revisions/:rev/diff`: Returns a line-by-line diff between a specified revision and the current post content, using a deterministic Longest Common Subsequence (LCS) algorithm.
        *   `POST /api/posts/:id/revisions/:rev/restore`: Restores a post to a chosen revision. Before applying the restore, it snapshots the *current* post state with the reason 'restore', making the restore action itself undoable.
*   **Client-side (`src/public/app.js`, `src/public/index.html`, `src/public/style.css`):**
    *   A "history" button has been added to the editor footer in `src/public/index.html`.
    *   Clicking the history button opens a modal (`history-modal`) that displays a list of revisions for the current post.
    *   Users can select a revision from the list to view its content differences against the current version in a dedicated diff view.
    *   The diff view visually highlights added, removed, and unchanged lines.
    *   A "restore this version" button is available in the modal to apply the selected revision to the current post.
    *   Keyboard navigation has been updated: the `Escape` key now closes the history modal if it's open.
    *   `src/public/style.css` includes new styles for the history modal, revision list, and the diff view elements.
*   **Testing (`src/server.test.ts`):**
    *   Extensive new tests validate the database migration, snapshotting logic (coalescing, pruning), API endpoint behavior (list, get, diff, restore), the correctness of the `lineDiff` algorithm, and the presence and wiring of the UI components.
*   **ADW Workflow (`adws/adw_document.py`):**
    *   The `adw_document.py` script's phases were updated to include a `git(commit_docs)` phase after the `documenter` agent, indicating that documentation is now committed in a separate step.
*   **New Documentation (`adws/app_docs/7b13de55_fts5-search-implementation.md`):**
    *   A new documentation file was added, detailing the FTS5 search implementation. While part of the same `previous_envelope`, its content is distinct from the revision history feature.

**Files that carry it:**
*   `adws/adw_document.py`: Modified to include the `commit_docs` phase.
*   `adws/app_docs/7b13de55_fts5-search-implementation.md`: A new documentation file for FTS5 search (not related to revision history but created in the same change).
*   `adws/specs/337dd8ff_revision-history.md`: The specification document for this revision history feature.
*   `src/public/app.js`: Client-side logic for history UI, API calls, and diff rendering.
*   `src/public/index.html`: Added history button and modal structure.
*   `src/public/style.css`: Styling for the history UI and diff display.
*   `src/server.test.ts`: New and updated tests for the revision history functionality.
*   `src/server.ts`: Backend implementation of revision management, API endpoints, and the `lineDiff` algorithm.

**How to use or verify it:**
*   **Verification via Tests:**
    1.  Run the full test suite using `bun test src/server.test.ts`. All tests should pass, confirming the correctness and functionality of the revision history system from both backend and frontend perspectives.
*   **Manual Verification:**
    1.  Start the Inkwell server by running `bun run src/server.ts`.
    2.  Open the Inkwell application in a web browser.
    3.  Create a new post or open an existing one.
    4.  Make several edits to the post content and observe how revisions are created (e.g., type continuously for a short period to see coalescing, then pause and make another edit to create a new revision).
    5.  Toggle the post's publish status to see associated revisions.
    6.  Click the "history" button in the editor footer to open the revision history modal.
    7.  Browse through the list of revisions, noting the `created_at`, `word_count`, and `reason` for each.
    8.  Select different revisions to view their content diff against the current post.
    9.  Click the "restore this version" button for a selected revision and confirm that the post content reverts.
    10. Verify that a restore operation itself creates a new 'restore' revision, allowing for "undoing" the restore by restoring the 'restore' revision.
    11. Delete a post and confirm that its revisions are also removed from the database.