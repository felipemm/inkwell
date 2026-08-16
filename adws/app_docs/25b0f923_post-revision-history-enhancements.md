# Post Revision History Enhancements

This change introduces significant enhancements to the post revision history functionality, enabling more comprehensive version tracking and management.

## What Changed

The core of this work involved expanding the capabilities of the post revision system, specifically by:

*   **Enriching Revision Listings:** The `GET /api/posts/:id/revisions` endpoint was updated to include the `title` and a `summary` (first 80 characters of content) for each revision, providing more context at a glance.
*   **Implementing Revision Comparison:** A new endpoint, `GET /api/posts/:id/revisions/:a/compare/:b`, was added to allow for detailed comparison between any two revisions of a post. This endpoint returns a line-by-line diff, along with counts of added and removed lines, and the word count delta between the two revisions. It handles cases where revisions do not belong to the specified post by returning a `400` error.
*   **Adding Revision Revert Functionality:** A new `POST /api/posts/:id/revisions/:revId/revert` endpoint was introduced. This allows users to restore a post to a previous revision's state. Crucially, before applying the revert, the *current* state of the post is snapshotted as a new revision (with reason "restore"), ensuring that the revert action itself is auditable and undoable.
*   **Developer Documentation and Specification:** New markdown files (`adws/prompts/11-post-revision-history--versioned-edits-w.md` and `adws/specs/25b0f923_revision-compare-revert.md`) were added, providing a detailed specification and implementation plan for these features.
*   **Test Suite Expansion:** Corresponding tests in `src/server.test.ts` were added or modified to cover the new `title` and `summary` fields in revision listings, the `compare` endpoint's functionality, and the `revert` endpoint's behavior and error handling. The "unknown ID returns 404" test was also extended to include the new routes.
*   **SDLC Robustness:** A minor change in `adws/adw_simple_sdlc.py` moves session creation before agent validation, improving the robustness of the development pipeline by ensuring a session is recorded even if initial validation fails.

## Files Changed

*   `adws/adw_data/prompt_engineering/reviewer/user.md`: Updated with guidance for reviewing uncommitted changes.
*   `adws/adw_simple_sdlc.py`: Adjusted the order of session creation and agent validation.
*   `adws/prompts/11-post-revision-history--versioned-edits-w.md`: New prompt defining the revision history features.
*   `adws/specs/25b0f923_revision-compare-revert.md`: New detailed specification for implementing compare and revert.
*   `src/server.test.ts`: Updated and new tests for revision listing, comparison, and revert.
*   `src/server.ts`: Modified `GET /api/posts/:id/revisions` and added new endpoints `GET /api/posts/:id/revisions/:a/compare/:b` and `POST /api/posts/:id/revisions/:revId/revert`.

## How to Verify

To verify this functionality:

1.  **Run Tests:** Ensure all tests pass by executing `bun test`. This covers the correctness of revision listings, comparisons, and revert operations, including various error conditions.
2.  **Type Check:** Confirm that there are no TypeScript errors by running `bun x tsc --noEmit`.
3.  **Manual Verification (Smoke Test):**
    *   Start the server.
    *   Create a new post via `POST /api/posts`.
    *   Perform several `PUT /api/posts/:id` operations to create revisions.
    *   Fetch revisions using `GET /api/posts/:id/revisions` and confirm that `title` and `summary` fields are present for each revision.
    *   Identify two revision IDs (`a` and `b`) for a post and call `GET /api/posts/:id/revisions/<a>/compare/<b>`. Observe the `diff`, `added`, `removed`, and `word_delta` fields. Test with valid and invalid revision IDs, and attempt a cross-post comparison to verify the `400` error.
    *   Select a revision ID (`revId`) and perform `POST /api/posts/:id/revisions/:revId/revert`. Verify that the post's content and title are updated to match the revision, and that a new revision with `reason: "restore"` has been created, capturing the state of the post *before* the revert.
    *   Check for `404` errors when accessing non-existent posts or revisions through these new endpoints.