# Add a small divider between title and text area

This change introduces a visual divider between the title input field and the main text editing area in the Inkwell editor. This enhances the user interface by providing clearer separation between these two key components.

## What changed

A `border-bottom` style was added to the `.title` CSS rule in `src/public/style.css`. This border uses the `--border` CSS variable, ensuring consistency with other UI elements and adapting to theme changes.

Additionally, a new test case was added to `src/server.test.ts` to verify that the `style.css` correctly applies this divider. The test specifically checks for the `border-bottom: 1px solid var(--border);` property within the standalone `.title` CSS block.

## Files changed

- `src/public/style.css`: Modified to add `border-bottom` to the `.title` class.
- `src/server.test.ts`: Updated with a new test to assert the presence of the divider style.

## How to use or verify

To verify this change:

1.  Run `bun test` to ensure all tests pass, including the new test for the divider.
2.  Manually inspect the UI:
    *   Start the development server with `bun run dev`.
    *   Navigate to `http://localhost:4501`.
    *   Open an existing post or create a new one. Observe a thin 1px divider line separating the title input from the markdown text area.
    *   Switch to split view (e.g., `⌘Enter` / `CtrlEnter` twice) and confirm the divider spans the full editor width, sitting above the two panes.
    *   Change themes through the `More` menu to confirm the divider's color adapts according to the `--border` CSS variable.