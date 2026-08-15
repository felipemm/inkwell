The `inkwell` application now supports scheduled publishing for posts, allowing users to specify a future date and time for a post to automatically transition from `draft` to `published` status.

### What changed and why it matters

This enhancement introduces a new `scheduled` post status and a `publish_at` timestamp. This enables content creators to plan and release posts on a predetermined schedule without requiring manual intervention at the exact publication time.

Key aspects of the implementation include:

*   **In-place Database Migration:** The `inkwell.db` schema is updated to include a `publish_at` column (`TEXT` for ISO-8601 UTC strings, nullable). This migration happens automatically when the database is opened, ensuring backward compatibility with existing databases.
*   **No Background Timers:** Publishing is not driven by `cron` jobs or `setInterval`. Instead, a `sweepScheduled()` mechanism identifies and publishes due posts on demand. This sweep is automatically triggered during `GET /api/posts` (list view) and `GET /api/posts/:id` (individual post view), ensuring that displayed content is always up-to-date.
*   **UTC Timestamp Storage:** All `publish_at` timestamps are stored in UTC ISO-8601 format (`YYYY-MM-DDTHH:mm:ss.sssZ`) to avoid timezone-related issues.
*   **Client-side Scheduling Interface:** The post editor now includes a `datetime-local` input and a "schedule" button, allowing users to easily set and manage publication times.

### The files that carry it

*   `adws/specs/579cadca_scheduled-publishing.md`: This document details the entire implementation plan, including tasks, constraints, and test cases.
*   `src/server.ts`:
    *   The `Post` TypeScript type now includes `publish_at: string | null`.
    *   The `db()` initialization handles the in-place database migration for the new column.
    *   New API routes:
        *   `POST /api/posts/:id/schedule`: To set a future `publish_at` timestamp and change the post's status to `scheduled`.
        *   `DELETE /api/posts/:id/schedule`: To cancel a scheduled post, reverting it to `draft` status and nulling `publish_at`.
        *   `POST /api/scheduled/run`: A manual trigger for the `sweepScheduled()` function.
    *   The `sweepScheduled()` function, which identifies and updates due posts, is implemented.
    *   Calls to `sweepScheduled()` are added to `GET /api/posts` and `GET /api/posts/:id` handlers.
    *   The existing `POST /api/posts/:id/publish` route is updated to clear `publish_at` when a post is published or unpublished.
*   `src/server.test.ts`: Expanded with numerous new tests covering:
    *   Database migration behavior.
    *   Functionality and error handling of `/api/posts/:id/schedule` routes.
    *   Correctness and idempotency of the `/api/scheduled/run` sweep.
    *   Verification of sweep-on-read logic for post lists and individual posts.
    *   Interactions between publishing/unpublishing and scheduling.
    *   The expected structure of post data in API responses (including `publish_at` for full posts, excluding it for summaries).
    *   Existence and functionality of UI elements and client-side helper functions.
*   `src/public/index.html`: Modified to embed the new `datetime-local` input (`#schedule-at`) and "schedule" button (`#schedule-btn`) within the editor's footer.
*   `src/public/app.js`:
    *   Updates the `ui` object to reference the new scheduling DOM elements.
    *   Introduces a new `// --- scheduled (pure) ---` section containing utility functions for UI logic: `dotClass`, `scheduleButtonLabel`, `toLocalInputValue`, and `toUtcIso`.
    *   `renderList()` is updated to use `dotClass` to display status-specific dots (including amber for `scheduled` posts).
    *   `renderEditor()` now dynamically updates the schedule input field and button label/state based on the current post's schedule status.
    *   An event listener is added to `scheduleBtn` to handle API calls for scheduling and canceling posts.
*   `src/public/style.css`: Defines new CSS variables (`--schedule`) for light and dark themes and provides styling for `.schedule-input`, `.dot.scheduled` (amber dot), and `.btn.is-scheduled` (amber text for the button).

### How to use or verify it

**To use the scheduled publishing feature:**

1.  Start the `inkwell` application (e.g., `bun run src/server.ts`).
2.  Open your browser to `http://localhost:4501`.
3.  Create a new post or select an existing one.
4.  In the editor's footer, locate the new date-time input field and the "schedule" button.
5.  Choose a future date and time in the input, then click "schedule". The post's status dot in the left sidebar will turn amber, and the button will change to "cancel schedule".
6.  To remove a schedule, click "cancel schedule". The post will revert to `draft` status, and its dot will become gray.

**To verify the implementation:**

1.  **Manual Verification:**
    *   Schedule a post for a time *in the past*. Refresh the page. The post should immediately appear as `published` (green dot) due to the sweep-on-read mechanism.
    *   Schedule a post for a time far in the future. Restart the server. The post should remain `scheduled` (amber dot), demonstrating persistence and that no in-memory timers are used.
    *   Test the interaction: Schedule a post, then click "publish" (the original publish toggle). The post should become `published` immediately, and its schedule should be cleared.
2.  **Automated Test Suite:** Run `bun test src/server.test.ts`. All tests, including the extensive new test cases for scheduled publishing, should pass. This confirms that both the backend logic and the client-side components function correctly and adhere to the project's constraints.
