import type { ZodRawShape } from "zod";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BookingStore } from "../store/memory-store.js";
import type { AuditLog } from "../policy/audit.js";

/**
 * READ tools — annotated with readOnlyHint: true and incapable of mutation.
 * An agent may call these freely; hosts can also use the annotation to
 * route/sandbox read traffic differently from write traffic.
 */
export function registerReadTools(server: McpServer, store: BookingStore, audit: AuditLog): void {
  server.registerTool(
    "list_customers",
    {
      title: "List customers",
      description: "List all customers. Read-only.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const customers = store.listCustomers();
      audit.record({ tool: "list_customers", kind: "read", ok: true, argsPreview: "{}" });
      return { content: [{ type: "text", text: JSON.stringify(customers, null, 2) }] };
    },
  );

  server.registerTool(
    "get_customer",
    {
      title: "Get customer",
      description: "Fetch a single customer by id. Read-only.",
      inputSchema: { id: z.number().int().positive() } satisfies ZodRawShape,
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const customer = store.getCustomer(id);
      audit.record({ tool: "get_customer", kind: "read", ok: !!customer, argsPreview: JSON.stringify({ id }) });
      return {
        content: [{ type: "text", text: customer ? JSON.stringify(customer, null, 2) : `Customer ${id} not found` }],
        isError: !customer,
      };
    },
  );

  server.registerTool(
    "list_bookings",
    {
      title: "List bookings",
      description: "List all bookings with their status. Read-only.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const bookings = store.listBookings();
      audit.record({ tool: "list_bookings", kind: "read", ok: true, argsPreview: "{}" });
      return { content: [{ type: "text", text: JSON.stringify(bookings, null, 2) }] };
    },
  );

  server.registerTool(
    "check_availability",
    {
      title: "Check availability",
      description:
        "Check which of the given 30-minute timeslots are available on a date (YYYY-MM-DD). Read-only.",
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
        times: z.array(z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM")).min(1).max(16),
      } satisfies ZodRawShape,
      annotations: { readOnlyHint: true },
    },
    async ({ date, times }) => {
      const availability = store.checkAvailability(date, times);
      audit.record({ tool: "check_availability", kind: "read", ok: true, argsPreview: JSON.stringify({ date, times }) });
      return { content: [{ type: "text", text: JSON.stringify(availability, null, 2) }] };
    },
  );
}
