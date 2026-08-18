# Increase Medium Type Width to 1118px

This change increases the "medium" type width option in the quiet room feature by 30%, from 860px to 1118px. This enhancement provides users with a wider content area when the medium width setting is selected, improving the reading and writing experience.

## Changes Introduced

-   **`src/public/app.js`**: The `TYPE_WIDTHS` constant was updated to set `medium: 1118`. This is the primary change that applies the new width dynamically.
-   **`src/public/style.css`**: The `--editor-max-width` CSS variable in the `:root` was updated to `1118px`. This ensures a consistent default width upon initial page load, preventing visual inconsistencies before `app.js` takes effect.
-   **`src/server.test.ts`**: A new test assertion (`expect(text).toContain("medium: 1118");`) was added to verify that the `app.js` file served by the server correctly includes the updated medium width value.
-   **`adws/adw_sssf_config/ticketing.yaml`**: A new configuration file was added to enable an internal ticketing provider. This change is separate from the width adjustment but was part of the same overall task.

## Verification

To verify the change:

1.  **Run tests**: Execute `bun test` to ensure all automated tests pass, confirming the new width assertion.
2.  **Syntax check**: Run `node --check src/public/app.js` to confirm JavaScript syntax is valid.
3.  **Manual smoke test**:
    *   Start the development server with `bun run dev`.
    *   Open `http://localhost:4501` in a browser.
    *   Observe that the default writing column is approximately 1118px wide.
    *   Use the `⋯` (three-dot) menu, then "Width":
        *   Verify that "narrow" sets the width to 640px.
        *   Verify that "medium" sets the width to approximately 1118px.
        *   Verify that "wide" sets a fluid width (`calc(100% - 96px)`).
    *   Confirm that your chosen width setting persists across page reloads.
    *   For users with a previously saved "medium" width setting, verify that they now experience the new 1118px width on load without needing to re-select it.