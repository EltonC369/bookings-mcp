import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import type { AuditLog } from "../src/policy/audit.js";
import type { BookingStore } from "../src/store/memory-store.js";

interface Harness {
  client: Client;
  store: BookingStore;
  audit: AuditLog;
}

async function connect(): Promise<Harness> {
  const { server, audit, store } = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, store, audit };
}

const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return d.toISOString().slice(0, 10);
})();

describe("read/write tool separation", () => {
  it("annotates read tools with readOnlyHint and leaves write tools unannotated", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    const byName = new Map(tools.map((t) => [t.name, t.annotations ?? {}]));
    expect(byName.get("list_customers")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("get_customer")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("list_bookings")).toMatchObject({ readOnlyHint: true });
    expect(byName.get("check_availability")).toMatchObject({ readOnlyHint: true });

    // Write tools must NOT claim to be read-only.
    expect(byName.get("create_booking")?.readOnlyHint).not.toBe(true);
    expect(byName.get("cancel_booking")?.readOnlyHint).not.toBe(true);
  });

  it("read tools work without any approval", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "list_customers", arguments: {} });
    expect(result.isError).toBeFalsy();
  });

  it("create_booking WITHOUT approval is blocked", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "create_booking",
      arguments: { customerId: 1, date: tomorrow, time: "11:00", service: "consultation" },
    });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("Invalid arguments for tool create_booking"); // zod rejects: approval is required
  });

  it("create_booking with a FORGED approval token is blocked", async () => {
    const { client } = await connect();
    const result = await client.callTool({
      name: "create_booking",
      arguments: {
        customerId: 1,
        date: tomorrow,
        time: "11:00",
        service: "consultation",
        approval: { token: "f".repeat(48), approvedBy: "attacker" },
      },
    });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("Unknown approval token");
  });
});

export { connect, tomorrow };
