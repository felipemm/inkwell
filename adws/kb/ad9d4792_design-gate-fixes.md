# Design Gate Fixes for Public UI

This change addresses design quality gate findings in `src/public/index.html` and `src/public/style.css` to ensure the `impeccable detect src/public` command passes without errors. The fixes resolve `skipped-heading`, `flat-type-hierarchy`, `dark-glow`, and `gpt-thin-border-wide-shadow` findings without altering the application's functionality or perceived visual appearance.

## What Changed

### 1. `src/public/index.html`

-   **Heading Hierarchy (`skipped-heading` fix):** All four popover section headings ("Appearance", "Writing", "View", "Post") were updated from `<h3>` to `<h2>`. This corrects an `h1` followed directly by `h3` in the document outline, establishing a proper `h1` then `h2` hierarchy. The visual presentation of these headings remains unchanged due to existing class-based styling.

### 2. `src/public/style.css`

-   **Typography Hierarchy (`flat-type-hierarchy` fix):** The `font-size` of the `.brand` element was increased from `20px` to `22px`. This expands the range of font sizes on the page, satisfying the minimum ratio requirement for type hierarchy and making the brand wordmark slightly more prominent without affecting layout.
-   **Glow Effects (`dark-glow` fix):** The `box-shadow` property, which created a zero-offset glow, was removed from both the `.dot.published` and `.dot.scheduled` CSS rules. Status dots now display their solid background colors without an accompanying halo.
-   **Shadow Geometry (`gpt-thin-border-wide-shadow` fix):** The `--shadow-modal` CSS variable was updated across all eight theme definitions (default dark, light, sepia, forest, midnight, ocean, rose, graphite). The shadow geometry `0 12px 32px` was changed to `0 4px 12px`. This significantly reduces the blur radius of modal and popover shadows, providing a tighter, more subtle elevation cue while preserving the essential hairline borders and clearing the design gate rule.

## Why it Matters

These changes bring the public UI into compliance with established design quality standards, as enforced by the `impeccable` tool. Resolving these findings improves the structural integrity of the HTML (heading hierarchy), refines typographic consistency, and subtly enhances visual polish by standardizing shadow treatments and removing unintended glow effects.

## Files Changed

-   `src/public/index.html`
-   `src/public/style.css`

## How to Verify

To confirm these fixes, run the design quality gate check:

```bash
impeccable detect src/public
```

This command should now exit with `0` and print no findings. Additionally, a visual inspection of the application should confirm that the overall look and functionality remain as intended: the brand text is slightly larger, modal and popover shadows are subtler, status dots no longer have a glow, and menu headings appear unchanged.