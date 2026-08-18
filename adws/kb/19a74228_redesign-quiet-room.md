The Inkwell application has been redesigned to provide a "quiet room" writing experience, minimizing distractions and reorganizing UI elements into two accessible menus.

### What changed and why it matters

The core idea behind this redesign is to transform Inkwell into a focused environment where the writing surface is paramount. Previously, the application suffered from a cluttered interface with an always-present sidebar and a footer strip filled with buttons. The new design addresses this by:

*   **Introducing a "Quiet Room" default layout:** Upon opening, Inkwell now presents a single, centered column of text with generous whitespace, removing all non-essential chrome.
*   **Consolidating features into two unobtrusive menus:**
    *   **Posts drawer:** Accessible via a "☰" button in the top-left or the `Cmd+P`/`Ctrl+P` shortcut, this slide-in menu from the left now houses the post list, search functionality, a "new post" button, and the total post count. It closes automatically upon selecting a post or creating a new one, or by pressing `Esc` or clicking outside.
    *   **More menu:** Accessed via an "⋯" button in the top-right, this popover menu contains all settings and actions, including theme toggles, font size controls, word goals, view mode switches, focus mode, keyboard shortcuts, and post actions (publish/delete). It closes by pressing `Esc` or clicking outside.
*   **Streamlined Footer:** The footer is now limited to passive readouts: word count, reading time, and save status. All interactive buttons have been moved to the "More menu".
*   **Restored Features:** Font sizing, word goals, and reading time, which were previously removed, have been reintroduced within the new menu structures, fulfilling a key requirement of the redesign.
*   **Enhanced Keyboard Shortcuts:** Existing shortcuts have been updated, and new shortcuts (`Cmd+P`/`Ctrl+P` for posts panel, `Cmd++`/`Ctrl++` and `Cmd−`/`Ctrl−` for font size) have been added. The `Esc` key now also closes the drawer and More menu in addition to other modals.
*   **Smooth Transitions:** UI elements like the drawer and popover utilize soft, non-disruptive transitions. A `prefers-reduced-motion` media query ensures that animations are disabled for users who prefer reduced motion.

These changes collectively aim to create a calmer, more focused writing experience, optimizing for continuous writing flow rather than library management.

### Files that carry it

*   **`public/index.html`**: This file was updated to include the new `topbar` with the "☰" and "⋯" buttons, re-structure the `sidebar` into a `posts-drawer`, introduce the `more-menu` popover with all its sections and controls, and simplify the `footer` to only display readouts. The `shortcuts-modal` was also updated to reflect the new and restored keyboard shortcuts.
*   **`public/style.css`**: New CSS rules were added to style the `topbar`, `drawer`, and `popover` elements, including their positioning, appearance, and transition animations. Adjustments were made to editor elements (`.title`, `.content`, `.preview`) to increase padding and modify font sizing to use a new CSS variable `--editor-font-size`. The `:focus-visible` selector was extended to new interactive elements, and a `@media (prefers-reduced-motion: reduce)` block was added.
*   **`public/app.js`**: The JavaScript code was modified to handle the new UI elements. This includes adding references to new DOM elements in the `ui` object, implementing functions for `openPosts()`, `closePosts()`, `openMore()`, `closeMore()`, `setFontSize()`, `applyFontSize()`, `calcReadingTime()`, and `updateGoal()`. Event listeners were added for the new buttons and keyboard shortcuts. The `save()` function was updated to persist the `target_word_count`.
*   **`server.test.ts`**: Existing tests related to the absence of word goals, reading time, and font size elements were updated to assert their *presence* within the new UI. New tests were added to verify the existence of the new quiet room chrome elements (`posts-btn`, `more-btn`, `posts-drawer`, `more-menu`) and the functionality of their open/close methods in `app.js` and their styles in `style.css`.
*   **`README.md`**: The `Keyboard Shortcuts` section was updated to list the new and restored shortcuts. The `Sidebar UI` and `Editor Footer` sections were replaced with a detailed `Quiet Room Layout` description, explaining the new default state and the function of the drawer and More menu. The `View Modes` section was also updated to reflect the mode switch's new location.

### How to use or verify it

1.  **Run Tests:** Execute `bun test` to ensure all tests pass. This will confirm that the updated and new tests for the UI elements and functionality are satisfied.
2.  **Start the Server:** Run `bun run server.ts` and navigate your browser to `http://localhost:4501`.
3.  **Observe the Quiet Room:**
    *   Verify that the application opens directly to a focused editor with only the writing column visible, flanked by a top-left "☰" (Posts) button and a top-right "⋯" (More) button, and a minimal footer showing "0 words · saved".
    *   **Posts Drawer:** Click the "☰" button or press `Cmd+P`/`Ctrl+P`. Confirm the drawer slides in from the left, showing the search input, post list, and total post count. Test searching, creating a new post, and selecting an existing post. Verify the drawer closes correctly by selecting a post, clicking outside, or pressing `Esc`.
    *   **More Menu:** Click the "⋯" button. Verify the popover menu appears. Test the theme toggle, font size adjustment buttons (`A−`/`A+`), and the `Cmd++`/`Ctrl++` and `Cmd−`/`Ctrl−` shortcuts. Input a word goal and observe the live percentage progress. Verify the view mode buttons (edit/split/preview) and the `Cmd+Enter`/`Ctrl+Enter` cycle. Test the focus toggle, shortcuts modal, publish/unpublish, and delete functionality. Verify the menu closes correctly by clicking outside or pressing `Esc`.
    *   **Footer:** Confirm the footer dynamically updates word count and shows reading time and save status.
    *   **Focus Mode:** Activate focus mode (`Cmd+Shift+F`/`Ctrl+Shift+F`). Verify the topbar hides and the footer dims. Confirm pressing `Esc` exits focus mode.
    *   **Shortcuts Modal:** Open the shortcuts modal (`?` or `Cmd+/`/`Ctrl+/`). Verify that the "Open posts panel", "Increase font size", and "Decrease font size" entries are present, along with existing shortcuts.
    *   **Persistence:** Reload the page after changing the theme, font size, or view mode. Confirm these settings persist.
4.  **Check for Smoothness:** Observe the transitions when opening/closing the drawer and More menu. If "reduced motion" is enabled in your operating system settings, confirm that transitions are disabled.
5.  **Console Check:** Open the browser's developer console and ensure there are no JavaScript errors or unexpected warnings.