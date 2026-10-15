import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BookingStore } from "./store/memory-store.js";
import { ApprovalStore } from "./policy/approvals.js";
import { AuditLog } from "./policy/audit.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerWriteTools } from "./tools/write-tools.js";

/**
 * Factory: builds a fully-configured server instance.
 * A fresh instance per connection keeps stateless HTTP deployments safe —
 * no state is shared between callers unless you explicitly pass shared
 * store/approval instances (see index.ts for the wiring decision).
 */
export interface ServerDeps {
  store?: BookingStore;
  approvals?: ApprovalStore;
  audit?: AuditLog;
}

export function buildServer(deps: ServerDeps = {}): { server: McpServer; audit: AuditLog; store: BookingStore } {
  const store = deps.store ?? new BookingStore();
  const approvals = deps.approvals ?? new ApprovalStore();
  const audit = deps.audit ?? new AuditLog();

  const server = new McpServer(
    { name: "bookings-mcp", version: "1.0.0" },
    {
      instructions:
        "Booking operations demo. Read tools (readOnlyHint) can be called freely. " +
        "Write tools REQUIRE an approval payload: call request_approval first, have a human " +
        "release the token, then pass { token, approvedBy } with the UNCHANGED arguments.",
    },
  );

  registerReadTools(server, store, audit);
  registerWriteTools(server, store, approvals, audit);

  return { server, audit, store };
}
