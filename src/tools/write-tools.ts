import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BookingStore } from "../store/memory-store.js";
import type { AuditLog } from "../policy/audit.js";
import { ApprovalStore } from "../policy/approvals.js";

const approvalSchema = z.object({
  token: z.string().min(16, "Approval token is required for write tools"),
  approvedBy: z.string().min(1, "Approval must name the human who approved"),
});

/**
 * WRITE tools — every one of them requires a valid approval payload bound
 * to the exact action (see src/policy/approvals.ts). There is no code path
 * that reaches the store's mutators without passing the gate.
 */
export function registerWriteTools(
  server: McpServer,
  store: BookingStore,
  approvals: ApprovalStore,
  audit: AuditLog,
): void {
  server.registerTool(
    "request_approval",
    {
      title: "Request human approval for a write action",
      description:
        "Queue a write action (create_booking or cancel_booking) for human approval. " +
        "Returns a one-time approval token bound to the EXACT arguments. The token must be " +
        "passed back, unchanged, in the write tool's `approval` argument. This tool only " +
        "mints approvals — it never executes the action itself.",
      inputSchema: {
        tool: z.enum(["create_booking", "cancel_booking"]),
        args: z.record(z.string(), z.unknown()),
        requester_note: z.string().optional(),
      } satisfies ZodRawShape,
    },
    async ({ tool, args, requester_note }) => {
      const approval = approvals.request(tool, args, "pending-human");
      audit.record({
        tool: "request_approval",
        kind: "approval",
        ok: true,
        argsPreview: JSON.stringify({ tool }),
        detail: requester_note,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: "Approval requested. A human must review and release this token.",
                approvalId: approval.token.slice(0, 8),
                token: approval.token,
                boundTo: { tool, args },
                expiresAt: new Date(approval.expiresAt).toISOString(),
                note: "Pass { token, approvedBy } in the write tool. Any change to the arguments invalidates the token.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "create_booking",
    {
      title: "Create a booking (approval required)",
      description:
        "Create a booking for an existing customer in a free 30-minute slot. " +
        "REQUIRES a prior approval from request_approval bound to these exact arguments.",
      inputSchema: {
        customerId: z.number().int().positive(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        service: z.string().min(1),
        approval: approvalSchema,
      } satisfies ZodRawShape,
      // No readOnlyHint: this tool mutates state by design.
    },
    async (args) => {
      const { approval } = args;
      const verdict = approvals.consume("create_booking", args, approval);
      if (!verdict.ok) {
        audit.record({ tool: "create_booking", kind: "write", ok: false, argsPreview: "{}", detail: verdict.reason });
        return { content: [{ type: "text", text: `BLOCKED BY APPROVAL GATE: ${verdict.reason}` }], isError: true };
      }

      const result = store.createBooking({
        customerId: args.customerId,
        date: args.date,
        time: args.time,
        service: args.service,
      });
      const ok = !("error" in result);
      audit.record({
        tool: "create_booking",
        kind: "write",
        ok,
        argsPreview: JSON.stringify({ customerId: args.customerId, date: args.date, time: args.time }),
        detail: ok ? `booking #${result.id}` : result.error,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !ok,
      };
    },
  );

  server.registerTool(
    "cancel_booking",
    {
      title: "Cancel a booking (approval required)",
      description:
        "Cancel an existing booking by id. " +
        "REQUIRES a prior approval from request_approval bound to these exact arguments.",
      inputSchema: {
        bookingId: z.number().int().positive(),
        approval: approvalSchema,
      } satisfies ZodRawShape,
    },
    async (args) => {
      const verdict = approvals.consume("cancel_booking", args, args.approval);
      if (!verdict.ok) {
        audit.record({ tool: "cancel_booking", kind: "write", ok: false, argsPreview: "{}", detail: verdict.reason });
        return { content: [{ type: "text", text: `BLOCKED BY APPROVAL GATE: ${verdict.reason}` }], isError: true };
      }

      const result = store.cancelBooking(args.bookingId);
      const ok = !("error" in result);
      audit.record({
        tool: "cancel_booking",
        kind: "write",
        ok,
        argsPreview: JSON.stringify({ bookingId: args.bookingId }),
        detail: ok ? `booking #${args.bookingId} cancelled` : result.error,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !ok };
    },
  );
}
