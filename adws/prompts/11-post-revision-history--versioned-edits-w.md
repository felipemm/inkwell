# Post revision history: versioned edits with diff and revert

Every edit to a post is versioned, so nothing a writer writes is ever lost.

## What to build

1. **Revisions are snapshots.** Any update to a post's title or content saves the PREVIOUS state (title, content, updated_at) as a new revision row. Creating a post does not create a revision; editing it does. The first edit of a post yields one revision holding its original state.
2. **Schema.** A `post_revisions` table (id, post_id FK, title, content, created_at, word_count). Additive migration in the existing style — CREATE TABLE IF NOT EXISTS — no destructive changes. Preserve existing rows and endpoints.
3. **API.**
   - `GET /posts/:id/revisions` → list of revisions for a post, newest first: id, created_at, title, word_count, summary (first ~80 chars of content). Empty list for a never-edited post. 404 for an unknown post.
   - `GET /posts/:id/revisions/:revId` → the full snapshot (title + content + created_at + word_count). 404 for unknown post or revision.
   - `GET /posts/:id/revisions/:a/compare/:b` → diff between two revisions: per-line added/removed (simple LCS or split-based diff is fine — no new dependency), plus added/removed line counts and word-count delta. 400 when a revision does not belong to the post; 404 when either side is unknown.
   - `POST /posts/:id/revisions/:revId/revert` → restore the revision: current state becomes a revision (same rule as an edit) and the post's title/content are set from the snapshot. Returns the restored post. 404 for unknown post or revision.
4. **Consistency.** Revisions are immutable — no update/delete endpoints. Word counts count whitespace-separated words. All endpoints return the same JSON shape conventions as the existing routes (check src/server.ts for the established patterns: status codes, error bodies, helpers).

## Tests (bun test — the suite must stay green)

- edit creates a revision holding the prior state
- first edit of a fresh post yields exactly one revision
- list is newest-first with word_count and summary
- compare returns added/removed lines and word deltas; cross-post compare is 400
- revert restores content AND creates a new revision of the pre-revert state
- unknown post/revision → 404
- typecheck passes (bun x tsc --noEmit)

## Out of scope

- No UI/editor changes, no tags interaction, no auth, no pagination (lists are small).

## Definition of done

All endpoints above exist, tests pass, `bun test` and `bun x tsc --noEmit` are green, and the code follows src/server.ts's existing conventions.

---
Generated from internal ticket  ()
