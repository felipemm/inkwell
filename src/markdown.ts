// Server-side markdown → safe HTML + reading-time helpers. Pure functions,
// no server imports, exported for direct unit testing.

import { marked } from "marked";

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Renders markdown to safe HTML: escape the source BEFORE markdown (so raw
 *  HTML like <script> is inert text), then strip dangerous URL schemes from
 *  any href/src marked produced (escape-before-markdown does NOT touch
 *  link destinations, so [x](javascript:alert(1)) would otherwise be live). */
export function renderMarkdown(src: string): string {
  const escaped = escapeHtml(src);
  const html = marked.parse(escaped, { async: false }) as string;
  return html.replace(/(href|src)="(?:javascript|vbscript|data):[^"]*"/gi, '$1="#"');
}

/** words ÷ 200, rounded up to a whole minute, minimum 1. Ceil (not round)
 *  matches the existing /api/posts/:id/stats convention in src/server.ts, so
 *  the app never shows a 250-word post as 1 min in the list and 2 min in stats.
 *  The prompt's examples (short → 1, ~400 → 2) hold under both rules. */
export function readingMinutes(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / 200));
}
