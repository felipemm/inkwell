The editor's title now scales with the zoom level. Previously, only the text area and preview scaled when the user adjusted the zoom with `⌘+`/`Ctrl+`, `⌘−`/`Ctrl−`, or the A+/A− buttons in the menu. This change ensures a consistent user experience by applying the zoom factor to the title as well.

This functionality was added by modifying `src/public/style.css`. The `.title` CSS rule's `font-size` property was changed from a fixed `30px` to `calc(var(--editor-font-size, 18px) + 12px)`. This `calc` function dynamically sets the title's font size based on the `--editor-font-size` CSS variable, which is controlled by the zoom functionality.

A new test has been added to `src/server.test.ts` to verify that `style.css` correctly implements this dynamic font sizing for the title. The test specifically checks that the `.title` rule contains `var(--editor-font-size)` and does not hardcode `font-size: 30px`.

To verify this change:
1. Run `bun test` to ensure all automated tests pass, including the new test for title font scaling.
2. Manually open the application (`bun run dev`), create a post with a title and body text.
3. Use `⌘+`/`Ctrl+` and `⌘−`/`Ctrl−` (or the A+/A− buttons in the menu) to zoom in and out. Observe that both the title input and the body text (and preview, if active) scale proportionally. At the default 18px editor font size, the title should render at 30px, maintaining its original appearance.