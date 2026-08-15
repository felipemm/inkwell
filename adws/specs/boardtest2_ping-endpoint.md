# Add a /ping endpoint returning pong

## Request

> add a /ping endpoint returning pong

A root-level liveness check: `GET /ping` responds with the literal string `pong`. It lives **outside** the JSON API namespace (`/api/*`) — the request names `/ping`, not `/api/ping` — and it does not touch the database. The body is the literal string `pong` served as `text/plain`, **not** `{"pong": true}` (the request says "returning pong", so the body is `pong`).

## Changes

### 1. `src/server.ts` — add the route

In `handleRequest` (line ~682, the `// ─── entry ───` section), insert the `/ping` branch **before** the `/api` branch, so it reads:

```ts
// ─── entry ─────────────────────────────────────────────────────────────────
export async function handleRequest(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (pathname === "/ping" && req.method === "GET") {
    return new Response("pong", { headers: { "content-type": "text/plain" } });
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    // ...unchanged
```

- Use the literal `new Response("pong", ...)` — no `json()` helper, no body wrapper.
- Only `GET` matches. Every other method (POST, PUT, DELETE, …) falls through to `serveStatic(pathname)` and gets the existing 404 — intended, do not add 405 handling for a root-level health route.
- Nothing else in the file changes: `handleApi`, the `json()` helper, the db layer, and the `/api/*` dispatch are all untouched.

### 2. `src/server.test.ts` — lock the contract (repo convention: every endpoint gets a test)

Insert a new feature section right **before** the first test `test("starts with an empty list", ...)` (line ~56), after the helper block:

```ts
// ─── Ping (spec: adws/specs/boardtest2_ping-endpoint.md) ───────────────────

test("GET /ping returns pong", async () => {
  const res = await fetch(`${base}/ping`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/plain");
  expect(await res.text()).toBe("pong");
});
```

- `base` is already defined by the module's `beforeAll` server fixture — no new setup.
- Assert status, content-type, and exact body. Do **not** parse JSON.

### 3. `README.md` — document the new route (one table row)

In the endpoint table (the `| Method | Route | Does |` table near the top), add a row at the **top** of the table, above the `/api/posts` rows, since `/ping` is a root-level route:

```markdown
| GET | `/ping` | Liveness check → `pong` |
```

Leave every other row untouched.

## Do NOT touch (unrelated or historical)

- `src/server.ts` `/api/*` dispatch, `handleApi`, the `json()` helper, db/schema code, `serveStatic`, and the `if (import.meta.main)` server bootstrap — all unchanged.
- `src/public/*` (app.js, style.css, index.html) — nothing client-side consumes `/ping`; no frontend work.
- `adws/specs/*` and `adws/app_docs/*` — historical records; do not rewrite them.
- The README sections below the endpoint table (Keyboard Shortcuts, Quiet Room Layout, View Modes) — unchanged.

## Verification (judge by exit status, not output text)

1. `bun test` — full suite passes, including the new `GET /ping returns pong` test. Exit status 0.
2. Manual smoke — `bun run src/server.ts`, then:
   - `curl -sS http://localhost:4501/ping` — exit 0, response body `pong`.
   - `curl -sS -o /dev/null -w "%{http_code}" http://localhost:4501/ping` — prints `200`.
   - `curl -sS -X POST -o /dev/null -w "%{http_code}" http://localhost:4501/ping` — prints `404` (non-GET falls through to static serving; intended).
