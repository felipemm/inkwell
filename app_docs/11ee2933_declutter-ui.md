# UI Decluttering and Agent-Driven Workflow Integration

This change significantly declutters the user interface of the Inkwell application and integrates a new Agent-Driven Workflow (ADW) system for managing development processes. The UI simplification aims to reduce distractions and improve focus for users, while the ADW system enhances the project's development and documentation capabilities.

## What Changed

### UI Simplification

The application's user interface has been streamlined by removing several elements that contributed to visual clutter:

*   **Removed Font Size Controls**: The dedicated buttons for increasing and decreasing editor font size (`Cmd++/Ctrl++` and `Cmd-/Ctrl-`) have been removed from the editor footer.
*   **Simplified Search Filter**: The live search result count and clear button for the search filter in the sidebar are no longer explicitly displayed.
*   **Streamlined Editor Footer**: Elements such as word count goals, estimated reading time, and progress percentage indicators have been removed from the editor footer. Only active post word count and auto-save status remain, alongside essential controls like focus mode, keyboard shortcuts help, view mode, publish/unpublish, and delete post.
*   **Updated Sidebar Footer**: The total word count has been removed. In its place, a new theme toggle button (☀/☾) has been added, allowing users to switch between light and dark themes.

These UI changes are reflected in:
*   `public/app.js`: JavaScript logic for the removed UI elements (font size, word goal, reading time, search count, total word count) has been removed. New logic for the theme toggle has been added, including detecting system dark mode preferences.
*   `public/index.html`: The HTML structure has been updated to remove the elements corresponding to the decluttered UI features and to include the new theme toggle button.
*   `public/style.css`: CSS rules for the removed UI elements have been deleted. New styles for the theme toggle and dark mode have been introduced, and existing styles have been adjusted to ensure a clean and minimalist aesthetic.
*   `README.md`: The documentation has been updated to reflect the streamlined keyboard shortcuts and UI elements, removing references to the features that are no longer present.
*   `server.test.ts`: End-to-end tests have been adjusted to remove assertions related to the presence of font size controls and word count goals, reflecting the updated UI.

### Agent-Driven Workflow (ADW) System

This update also introduces a foundational Agent-Driven Workflow (ADW) system, designed to automate and manage various stages of software development, from planning and building to reviewing and documenting. While not directly visible in the Inkwell UI, these changes are crucial for the project's internal development processes.

Key components of the ADW system include:

*   **ADW Scripts**: A suite of Python scripts (`adws/adw_build.py`, `adws/adw_build_review.py`, `adws/adw_build_test.py`, `adws/adw_document.py`, `adws/adw_plan.py`, `adws/adw_plan_build.py`, `adws/adw_plan_build_test.py`, `adws/adw_plan_build_test_quality.py`, `adws/adw_prompt.py`, `adws/adw_quality.py`, `adws/adw_scout.py`, `adws/adw_simple_sdlc.py`) that define various automated workflows, enabling agents to build, review, test, and document changes.
*   **Prompt Engineering**: Dedicated system and user prompt definitions for various agents (builder, documenter, planner, reviewer, scout) are now located under `adws/adw_data/prompt_engineering/`, guiding their behavior and task execution.
*   **Subagent Management**: A new Pi extension, `adws/adw_data/harness_engineering/subagents.ts`, introduces the ability to spawn and manage background subagents with persistent sessions directly from the Pi interface using `/sub`, `/subcont`, `/subrm`, and `/subclear` commands. This enhances parallel task execution and conversation continuity.
*   **Theme Mapping for Extensions**: The `adws/adw_data/harness_engineering/themeMap.ts` file provides a mechanism to assign specific themes to Pi extensions, ensuring a consistent visual experience and preventing theme conflicts.
*   **Configuration and Environment**: A new SSSF configuration (`adws/adw_sssf_config/sssf.config.yaml`) and an environment variable sample file (`.env.sample`) are introduced to manage agent settings and API keys. The `.gitignore` has been updated to exclude SSSF session data and the database.

## How to Use or Verify

### UI Decluttering

*   **Verify Removed Features**: Open `public/index.html` in a browser. Observe that the font size controls, live search count, reading time, word goal, and progress bar are no longer present.
*   **Test Theme Toggle**: Click the new sun/moon icon in the sidebar footer to switch between light and dark themes. The application's appearance should change accordingly.
*   **Check Responsiveness**: Ensure the UI remains functional and aesthetically pleasing across different window sizes.

### ADW System

*   **Run an ADW**: Execute an ADW using the `sssf` CLI, for example: `sssf run adw_build "Implement a new feature"` to see the builder agent in action.
*   **Manage Subagents**: If using Pi, load the `subagent-widget` extension and try spawning a subagent with `/sub "list files and summarize"`, then continue it with `/subcont 1 "now refine the summary"`.
*   **Inspect Agent Prompts**: Review the markdown files in `adws/adw_data/prompt_engineering/` to understand the instructions given to each agent.
*   **Review Configuration**: Examine `adws/adw_sssf_config/sssf.config.yaml` to see how agents and models are configured.
