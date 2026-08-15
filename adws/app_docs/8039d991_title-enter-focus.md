The change introduces a quality-of-life improvement to the editor, allowing users to seamlessly transition from typing a post's title to its content by pressing the `Enter` key.

This functionality is implemented in `src/public/app.js` by adding a `keydown` event listener to the title input field. When an unmodified `Enter` key is pressed, the default browser behavior is prevented, and focus is programmatically shifted to the content textarea. This preserves existing keyboard shortcuts, such as `Cmd/Ctrl+Enter` for cycling view modes.

A new presence test has been added to `src/server.test.ts`. This test verifies that `app.js` contains the new `keydown` listener for the title and the call to `ui.content.focus()`, ensuring the intended behavior is present in the delivered JavaScript.

To verify the changes:
- Run `bun test` to confirm all tests pass, including the new frontend presence test.
- Start the development server (`bun run dev`) and navigate to the editor. Type a title and press `Enter`; the cursor should move to the content area. Verify that `Cmd/Ctrl+Enter` still cycles view modes while focused in the title field.