# Theme Picker Upgrade

This change replaces the two-state (light/dark) theme toggle with a five-theme picker, offering more customization options for the writing environment. The new themes are Dark, Light, Sepia, Forest, and Midnight. The underlying theme engine and existing user preferences are preserved, ensuring backward compatibility.

## What Changed

The application's theme selection mechanism has been upgraded from a simple toggle to a dropdown picker with five distinct themes. This allows users to choose from a wider range of visual styles for their writing interface. The default theme remains "Dark", and any previously saved theme (light or dark) will continue to be applied correctly.

## Files Modified

*   **`README.md`**: Updated the description of the "More menu" to reflect the new "theme picker" and list the five available themes.
*   **`src/public/app.js`**: The JavaScript logic for theme management was refactored. The previous button-based toggle mechanism was replaced with code that populates a `<select>` element with themes, applies the selected theme to the `<html>` element's `data-theme` attribute, and persists the choice in `localStorage`. Core functions like `availableThemes()`, `currentTheme()`, and `applyTheme()` were adapted to support the new picker.
*   **`src/public/index.html`**: The UI for theme selection in the "More menu" was changed. The `<button id="theme-toggle">` was replaced by a `<select id="theme-select">` element, pre-populated with options for "Dark", "Light", "Sepia", "Forest", and "Midnight".
*   **`src/public/style.css`**:
    *   The `--themes` CSS variable in `:root` was extended to include the new themes: `dark light sepia forest midnight`.
    *   New CSS theme blocks (`[data-theme="sepia"]`, `[data-theme="forest"]`, `[data-theme="midnight"]`) were added. Each block defines a complete set of CSS custom properties (colors for background, text, borders, accents, etc.) to style the application for its respective theme.
    *   Specific styling for the old `#theme-toggle` button was removed.
*   **`src/server.test.ts`**: The integration test for theme functionality was updated to verify the presence and correct functioning of the new theme picker. It now asserts the existence of the `<select>` element, the five theme options in the HTML, the expanded `--themes` variable and new theme-specific CSS rules in `style.css`, and the new theme-related JavaScript functions in `app.js`.

## How to Use and Verify

### Usage

1.  Open the application and click the `⋯` button to open the "More menu".
2.  In the "Appearance" section, locate the "Theme" dropdown.
3.  Select any of the five themes: "Dark", "Light", "Sepia", "Forest", or "Midnight". The application's visual theme will update instantly.
4.  The chosen theme will persist across browser sessions and page reloads.

### Verification

#### Automated Tests

*   Run `bun test` in your terminal. All tests, including the updated theme test, should pass successfully.

#### Manual Smoke Test

1.  Start the development server: `bun run dev`.
2.  Open your browser to `http://localhost:4501`.
3.  Open the "More menu" (`⋯`).
4.  Confirm that the "Theme" control is now a dropdown menu (`<select>`) containing the options: Dark, Light, Sepia, Forest, Midnight.
5.  Select each theme (Light, Sepia, Forest, Midnight) sequentially and observe that the application's entire UI (sidebar, editor, menus, modals, buttons) correctly applies the selected theme's color palette.
6.  Select a non-default theme (e.g., "Forest"). Reload the page and verify that the "Forest" theme is active immediately upon load, before the main JavaScript bundle fully executes. This confirms the pre-hydration script in `index.html` is still working correctly with the new themes.
7.  Verify that setting a non-existent theme value in `localStorage` (e.g., `localStorage.setItem('inkwell-theme', 'invalid')`) and reloading the page correctly falls back to the default "Dark" theme without errors in the console.
8.  Ensure that other appearance controls, such as font selection and text width, continue to function as expected alongside the new theme picker.
