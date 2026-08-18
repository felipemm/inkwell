The recent changes introduce three new theme options—Ocean, Rose, and Graphite—to the application's theme picker, expanding the visual customization available to users. This enhancement directly addresses the request to "add more theme options" by providing fresh aesthetic choices.

The changes are implemented across the following files:

*   `README.md`: The "More menu" description has been updated to reflect the inclusion of "ocean", "rose", and "graphite" in the list of available themes.
*   `src/public/index.html`: Three new `<option>` elements corresponding to "Ocean", "Rose", and "Graphite" have been added to the `#theme-select` dropdown, making them selectable in the user interface.
*   `src/public/style.css`: The `--themes` CSS custom property in the `:root` selector was updated to include the new theme names. Additionally, dedicated CSS blocks (`[data-theme="ocean"]`, `[data-theme="rose"]`, `[data-theme="graphite"]`) were introduced, each defining a complete set of color variables for its respective theme.
*   `src/server.test.ts`: The theme-related test has been updated to assert the presence of all eight themes, including the newly added "Ocean", "Rose", and "Graphite", both in the HTML structure of the theme picker and within the `--themes` variable and data-theme CSS blocks in `style.css`.
*   `adws/specs/ec1cdc03_more-themes.md`: This new file serves as an implementation plan, detailing the comprehensive steps and rationale behind adding these new themes. It ensures clarity and traceability for future development.

To use the new themes, navigate to the "More menu" in the application and select "Ocean," "Rose," or "Graphite" from the theme picker. The application's interface will immediately update to reflect the chosen color scheme.

To verify the implementation:
1.  Run the application locally.
2.  Open the "More menu" and confirm that "Ocean", "Rose", and "Graphite" are listed in the theme selection dropdown.
3.  Select each new theme to visually confirm that its unique color palette is applied correctly throughout the application.
4.  Ensure that previously existing themes (Dark, Light, Sepia, Forest, Midnight) continue to function as expected.
5.  Run the test suite (`bun test`) to confirm that all tests pass, particularly the updated theme test in `src/server.test.ts`, which now validates the presence and correct setup of all eight themes.