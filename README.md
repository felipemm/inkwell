# inkwell
Minimalist blog-writing app — drafts, an editor, one-click publish. Bun + `bun:sqlite`, zero dependencies.

Drafts autosave as you type.

- **Tech stack:** Bun, SQLite (`bun:sqlite`), vanilla JS
```bash
bun run src/server.ts   # http://localhost:4501 — PORT and INKWELL_DB env overrides
bun test            # end-to-end API suite against a temp db
```
| Method | Route | Does |
| --- | --- | --- |
| GET | `/ping` | Liveness check → `pong` |
| GET | `/api/posts` | List `{id, title, status, updated_at, word_count, target_word_count}`, newest updated first (supports `?q=term` / `?search=term`) |
| POST | `/api/posts` | Create a draft from `{title?, content?, target_word_count?}` |
| GET | `/api/posts/:id` | Full post |
| PUT | `/api/posts/:id` | Update `{title?, content?, target_word_count?}` |
| POST | `/api/posts/:id/publish` | Toggle draft ⇄ published |
| DELETE | `/api/posts/:id` | Delete → `{ok: true}` |

## Keyboard Shortcuts

- `Cmd+N` / `Ctrl+N`: Create new post
- `Cmd+P` / `Ctrl+P`: Open posts panel
- `Cmd+S` / `Ctrl+S`: Save current post
- `Cmd+Enter` / `Ctrl+Enter`: Cycle view mode (edit → split → preview)
- `Cmd++` / `Ctrl++`: Increase font size
- `Cmd+-` / `Ctrl+-`: Decrease font size
- `Cmd+Shift+F` / `Ctrl+Shift+F`: Toggle focus mode
- `?` or `Cmd+/` / `Ctrl+/`: Open/toggle keyboard shortcuts help modal
- `Esc`: Close the shortcuts modal, posts drawer, or More menu / exit focus mode

An interactive keyboard shortcuts modal is accessible via the More menu's `shortcuts` button or `?` / `Cmd+/` shortcut.

## Quiet Room Layout

Inkwell opens as a quiet room: one centered column of text, no sidebar, no button strips. Everything else waits in two unobtrusive menus and gets out of the way after use.

- **Posts drawer** (`☰` button or `Cmd+P` / `Ctrl+P`): slides in from the left with the search filter (`#search-input`), `+ new`, the post list, and the total post count. It closes on `Esc`, on a click outside, or after opening a post / creating a new one.
- **More menu** (`⋯` button): a popover holding the theme picker (dark / light / sepia / forest / midnight), text size (`A−` / `A+`), the word goal, the view-mode switch, focus mode, keyboard shortcuts, publish/unpublish, and delete.
- **Editor footer**: readouts only — word count, reading time (`N min read`), and auto-save status (`saved`/`saving`).

## View Modes

- **edit**: textarea only.
- **split**: editor on the left, live-rendered markdown preview on the right, with a divider and `MARKDOWN` / `PREVIEW` pane labels; the preview updates on every keystroke.
- **preview**: rendered output only.

Cycle with `Cmd+Enter` / `Ctrl+Enter` or use the mode switch inside the More menu (`⋯`). The chosen mode persists while switching posts. Below ~860px viewport width, split mode stacks the panes vertically.

