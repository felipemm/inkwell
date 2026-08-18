# Fix: Duplicate 'escapeHtml' Declaration in `app.js`

This change addresses a critical `SyntaxError` in `src/public/app.js` caused by the duplicate declaration of the `escapeHtml` function. This error prevented `app.js` from parsing, leading to a completely broken application.

## What Changed

The `src/public/app.js` file previously contained two top-level declarations of `escapeHtml`. Because `app.js` is loaded as an ES module, strict mode rules disallow duplicate identifiers, resulting in an `Uncaught SyntaxError`.

To resolve this, the `escapeHtml` function within the `// --- history (pure) ---` section of `src/public/app.js` was renamed to `escapeHtmlText`. Its single call site was also updated to use the new name. This allows both the `markdown` and `history (pure)` sections to remain self-contained, as per existing conventions, while resolving the module-level naming conflict.

Additionally, a new regression test was added to `src/server.test.ts` to prevent this issue from recurring. This test explicitly checks that `escapeHtml` is declared exactly once at the top level of `app.js`.

A minor update to `package.json` adjusted the `dev` script to `bun --watch run src/server.ts`, ensuring the correct entry point for the development server.

## Files Changed

*   `adws/specs/df0335e6_fix-duplicate-escapehtml.md`: New specification detailing the problem and solution.
*   `package.json`: Updated `dev` script entry.
*   `src/public/app.js`: Renamed `escapeHtml` to `escapeHtmlText` and updated its call site within the `history (pure)` section.
*   `src/server.test.ts`: Added a new test to verify `escapeHtml` is declared only once in `app.js`.

## Verification

To verify this fix:

1.  Run `node --check src/public/app.js`. This command should now exit successfully with status 0, indicating no `SyntaxError`.
2.  Execute the test suite using `bun test`. All tests, including the newly added regression test, should pass.
3.  (Optional) Run the application in development mode (`bun run dev`) and navigate to `http://localhost:4501` (or your configured port). Confirm that there are no `SyntaxError` messages in the browser console and the editor functions as expected.
