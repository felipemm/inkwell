The recent change enhances the editor footer by adding live character, paragraph, and sentence counts, alongside the existing word count and reading time. This provides writers with a more comprehensive overview of their content's composition in real-time.

The core of this feature lives in `src/public/app.js`, which now includes three new pure JavaScript functions: `countChars`, `countParagraphs`, and `countSentences`. These functions calculate their respective statistics from the editor's content. The existing `updateWordCount()` function was extended to call these new counting functions and update corresponding `<span>` elements in the footer.

The user interface (`src/public/index.html`) was updated to include three new `<span>` elements with IDs `char-count`, `para-count`, and `sentence-count` within the editor's footer. These elements display the calculated statistics. The `README.md` file was also updated to reflect these new footer readouts.

To verify this change:
1.  **Automated Tests:** Run `bun test`. All tests, including three new ones in `src/server.test.ts` that cover the HTML structure, the pure counting functions, and their integration with `updateWordCount()`, should pass.
2.  **Manual Smoke Test:** Start the development server (`bun run dev`) and navigate to the application. Open or create a post and begin typing in the editor. The footer should now display character, paragraph, and sentence counts that update dynamically with every keystroke.

The following files were changed:
*   `README.md`
*   `adws/prompts/10-add-more-statistics-in-the-footer.md`
*   `adws/specs/8a689dfe_footer-statistics.md`
*   `src/public/app.js`
*   `src/public/index.html`
*   `src/server.test.ts`