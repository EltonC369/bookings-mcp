# AGENTS.md

Guidance for AI coding agents working in this repository.

## Overview

`bookings-mcp` is an MCP server (TypeScript ESM, Node >= 20) exposing booking
tools with strict read/write separation and approval-gated writes.

## Commands

```bash
npm ci               # install (lockfile present)
npm run build        # tsc -> dist/
npm test             # vitest run (must stay green: 19 tests)
npm run typecheck    # tsc --noEmit
npm run dev          # stdio transport via tsx
npm run dev:http     # Streamable HTTP on 127.0.0.1:3270 via tsx
```

Run tests and typecheck before declaring any task done.

## Code map

- `src/index.ts` — entry point; stdio by default, `--http [--port <n>]` for HTTP.
- `src/server.ts` — `buildServer(deps?)` factory; wires store/approvals/audit and registers tools.
- `src/transport/http.ts` — stateless Streamable HTTP on `POST /mcp`; optional bearer auth (`BOOKINGS_MCP_TOKEN`).
- `src/store/` — domain types + in-memory `BookingStore` (fictional seed data).
- `src/policy/approvals.ts` — `ApprovalStore`: SHA-256 binding of tool + canonicalized args, single-use, 10-min TTL.
- `src/policy/audit.ts` — `AuditLog`: one structured entry per tool call.
- `src/tools/read-tools.ts` — 4 read tools, all `readOnlyHint: true`.
- `src/tools/write-tools.ts` — `request_approval`, `create_booking`, `cancel_booking`.
- `tests/` — vitest suites driving a real MCP client over `InMemoryTransport`.

## Rules (non-negotiable)

1. **Never add a write tool that bypasses the `ApprovalStore`.** Every mutating
   tool must consume a valid approval via `ApprovalStore.consume()` before
   touching the store. No exceptions, no "internal" shortcuts.
2. **Every new tool needs tests in `tests/`.** Include the blocked paths
   (missing/forged/tampered approval), not just the happy path.
3. **`readOnlyHint: true` only on tools that cannot mutate.** If a tool writes
   anywhere, it must not carry the annotation — and must go through the gate.
4. **No secrets in code or commits.** All configuration (e.g.
   `BOOKINGS_MCP_TOKEN`) comes from environment variables.
5. **Keep the server stateless per HTTP request.** One fresh server + transport
   per request; shared state only via explicitly injected deps
   (`buildServer(deps)` / `startHttpServer(port, deps)`).
