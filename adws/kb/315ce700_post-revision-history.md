This change implements a new "Post Revision History" feature, introducing versioned edits, diffing, and revert capabilities for post content. It overhauls how post revisions are stored and accessed, ensuring that every significant edit to a post's title or content is permanently recorded.

### What changed

The core of this feature is the introduction of a new `post_revisions` SQLite table in `src/server.ts`, which stores immutable snapshots of a post's state (title, content, created_at, word_count) prior to an edit. This new table replaces the legacy `revisions` table for new revision captures.

Key changes include:

-   **Schema Update**: A `post_revisions` table is added in `src/server.ts`, with columns `id`, `post_id`, `title`, `content`, `created_at`, and `word_count`. The existing `revisions` table remains untouched for historical data but is no longer written to.
-   **Revision Capture Logic**: The `snapshotPost` function in `src/server.ts` has been replaced with `snapshotRevision`. This new function ensures that a post's previous state is snapshotted into `post_revisions` whenever its `title` or `content` is updated. Crucially, post creation, no-op updates, and publish toggles no longer create revisions.
-   **API Endpoints**:
    -   `GET /api/posts/:id/revisions`: Updated to return a list of revisions from the `post_revisions` table, ordered newest first, including `id`, `created_at`, `title`, `word_count`, and a `summary` of the content (first 80 characters).
    -   `GET /api/posts/:id/revisions/:revId`: Updated to retrieve a full revision snapshot from `post_revisions`.
    -   `GET /api/posts/:id/revisions/:a/compare/:b`: A new endpoint that compares the content of two revisions (`a` and `b`) for a given post. It returns a line-by-line diff, counts of added and removed lines, and a word count delta.
    -   `POST /api/posts/:id/revisions/:revId/revert`: A new endpoint that allows reverting a post to a specified revision. Before applying the revert, the post's current state is snapshotted into `post_revisions`, making the revert action itself undoable.
    -   **Legacy Endpoint Repointing**: The existing `GET /api/posts/:id/revisions/:rev/diff` and `POST /api/posts/:id/revisions/:rev/restore` endpoints have been modified to query the new `post_revisions` table. The `/restore` endpoint now behaves identically to the new `/revert` endpoint.
-   **No Coalescing or Pruning**: Unlike the previous revision system, the `post_revisions` table does not coalesce revisions or prune old ones; every snapshot is retained indefinitely.
-   **Test Suite Updates**: `src/server.test.ts` has been extensively updated to validate the new revision behavior and API endpoints, replacing or modifying tests that pertained to the old revision contract. A new `postRevisionsOf` helper assists in testing the new table.

### Why it matters

This feature directly addresses the requirement for comprehensive version control of post content. Writers can now be confident that no edits are ever lost, and they have the ability to review, compare, and revert to any past state of their work. The new system is additive, preserving existing legacy revision data while introducing a more robust and complete versioning mechanism.

### How to use or verify

To verify the new revision history functionality:

1.  **Schema and Migration**: Confirm that the `db()` function in `src/server.ts` creates the `post_revisions` table with the specified columns and an index on `post_id` and `id DESC`.
2.  **Revision Creation**: 
    -   Create a new post. No revision should be created.
    -   Edit the post's title or content using a `PUT` request. Verify that a new entry is added to the `post_revisions` table, reflecting the *pre-edit* state of the post.
    -   Perform a no-op `PUT` (no change to title or content) or change only `target_word_count`. No new revision should be created.
    -   Toggle a post's publish status. No new revision should be created.
    -   Perform multiple content edits in quick succession. Verify that each edit creates a distinct revision in `post_revisions` (no coalescing).
3.  **API Endpoint Functionality**:
    -   `GET /api/posts/:id/revisions`: Fetch the list of revisions for an edited post. Verify the response shape includes `id`, `created_at`, `title`, `word_count`, and a `summary`. Confirm revisions are ordered newest first. For a never-edited post, an empty array should be returned.
    -   `GET /api/posts/:id/revisions/:revId`: Fetch a specific revision. Verify the full snapshot (title, content, etc.) is returned. Test edge cases like unknown post or revision (`404`).
    -   `GET /api/posts/:id/revisions/:a/compare/:b`: Compare two revisions. Verify the returned `lines` array, `added`, `removed` counts, and `word_delta`. Test cases for unknown revisions (`404`) and revisions belonging to different posts (`400`).
    -   `POST /api/posts/:id/revisions/:revId/revert`: Revert a post to a past revision. Verify that the post's content and title are updated, and that a new revision is created capturing the state *before* the revert. Confirm that the revert itself is undoable. Test edge cases.
    -   Confirm that the legacy `/diff` and `/restore` endpoints continue to function as expected, now leveraging the `post_revisions` table.
4.  **Delete Cascade**: Delete a post and verify that all associated entries in `post_revisions` are also deleted.
5.  **Automated Tests**: Run `bun test`, `bun x tsc --noEmit`, and `bun build src/server.ts --outdir /tmp/inkwell-build --target bun`. All should pass successfully.