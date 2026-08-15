# Type Area Width Options

This change introduces the ability for users to adjust the width of the main content (type area) within the application. This enhancement provides a more personalized writing and reading experience by allowing users to choose from three predefined width settings.

## What Changed

*   **User Interface:** A new "Width" control has been added to the "Appearance" section of the "More" menu (accessible via the `⋯` icon in the top-right corner). This control presents three options: "narrow" (560px), "medium" (720px), and "wide" (960px). The "medium" setting maintains the application's default width.
*   **Styling:**
    *   A new CSS custom property, `--editor-max-width`, was introduced in `src/public/style.css` and initialized to `720px`.
    *   The `max-width` property for `.title`, `.content`, and `.preview` elements in `src/public/style.css` now uses `var(--editor-max-width)`, making their width configurable.
    *   New styles for the `.width-switch` control were added to `src/public/style.css` to ensure consistent visual presentation.
*   **Logic:**
    *   The `src/public/app.js` file now contains JavaScript logic to manage the selected type area width. This includes:
        *   Defining the pixel values for "narrow", "medium", and "wide" settings.
        *   Functions (`applyTypeWidth`, `setTypeWidth`, `initTypeWidth`) to apply the chosen width by updating the `--editor-max-width` CSS variable, visually indicating the active button, and persisting the selection in `localStorage` under the key `inkwell-type-width`.
        *   Event listeners were added to the width buttons to trigger the width change when clicked.
*   **Tests:** `src/server.test.ts` was updated with new presence assertions to confirm that `index.html` contains the new width-related data attributes and that `app.js` includes the new JavaScript functions (`TYPE_WIDTHS`, `setTypeWidth`, `applyTypeWidth`).

## Why It Matters

This feature significantly improves user customization and accessibility. Users can now optimize their workspace for readability and comfort, whether they prefer a focused, narrow column for writing or a wider layout for extensive content. The persistence of the setting ensures a consistent experience across sessions.

## How to Use or Verify

1.  **Open the application:** Navigate to `http://localhost:4501` (if running locally with `bun run dev`).
2.  **Access the "More" menu:** Click on the `⋯` icon in the top-right corner of the application to open the menu.
3.  **Adjust Type Area Width:** In the "Appearance" section, locate the new "Width" control. Click on "narrow", "medium", or "wide" to change the type area's width.
4.  **Verify Persistence:** Observe that the main content area's width changes instantly. Reload the page and confirm that the selected width persists.
5.  **Verify Split View:** Switch to split view mode; confirm that the width settings do not affect the side-by-side layout in split view, as intended.
6.  **Run Tests:** Execute `bun test` to ensure all automated tests pass, including the new presence checks for the width feature.
7.  **Check JavaScript Sanity:** Run `node --check src/public/app.js` to confirm that the updated JavaScript file has no module-scope issues.