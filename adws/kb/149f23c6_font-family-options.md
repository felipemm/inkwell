The Inkwell application now offers users the ability to customize the font family of the writing surfaces (title, editor textarea, and live preview) through a new font picker in the "More" menu. This enhancement provides 12 distinct system font options, ensuring a personalized writing environment, and persists the user's selection across sessions via local storage.

**What Changed:**

A font selection dropdown has been integrated into the "Appearance" section of the "More" menu. This dropdown presents a choice of 12 system font stacks, including "Serif", "Sans", "Mono", "Georgia", "Garamond", "Palatino", "Book Antiqua", "Didot", "Baskerville", "Courier", "Trebuchet MS", and "Verdana". The selected font dynamically updates the editor's text areas and is saved to the browser's local storage under the key `inkwell-font-family`, ensuring the preference is retained upon revisiting the application. The default font is "Serif", maintaining the existing visual style for returning users who have not made a selection. Additionally, a new `/ping` endpoint was introduced, returning "pong" for liveness checks.

**Where it Lives:**

*   `src/public/index.html`: The HTML structure for the font selection dropdown (`<select id="font-select">`) and its options is added within the "Appearance" section of the "More" menu.
*   `src/public/style.css`: A new CSS custom property, `--editor-font`, is defined in `:root` and applied to the `.title`, `.content`, and `.preview` selectors. This allows JavaScript to control the editor's font. Styling for the `.font-select` element is also included.
*   `src/public/app.js`: Contains the core logic for the font feature. This includes a `FONTS` map associating font names with CSS font stacks, functions (`applyFontFamily`, `setFontFamily`) to manage font application and persistence, and an event listener to respond to user selections. The initial font is loaded from local storage or defaults to "Serif".
*   `src/server.test.ts`: New end-to-end tests verify the presence of the font picker in `index.html`, the CSS definitions in `style.css`, and the JavaScript logic for font handling in `app.js`. A test for the new `/ping` endpoint is also included.
*   `src/server.ts`: Implements the new `/ping` GET endpoint.

**How to Use or Verify It:**

To use the feature, navigate to the Inkwell application in your browser, open the "More" menu, and select a desired font from the "Font" dropdown in the "Appearance" section. The editor's main text areas will update instantly. Your choice will be remembered for future sessions.

To verify the implementation:
1.  Run the application locally using `bun run dev`.
2.  Open `http://localhost:4501` in a web browser.
3.  Access the "More" menu (typically an ellipsis icon `⋯`).
4.  Within the "Appearance" section, locate the "Font" dropdown.
5.  Select various font options and observe the real-time changes in the editor's title, content area, and live preview.
6.  Reload the page to confirm that your selected font persists.
7.  Run the automated tests with `bun test` to ensure all checks, including those for the new font feature, pass.
8.  Verify the `/ping` endpoint by accessing `http://localhost:4501/ping`, which should return "pong".