import { describe, expect, it } from "vitest";
import { connect, tomorrow } from "./read-write-separation.test.js";

describe("audit trail", () => {
  it("every tool call is audited with its kind and outcome", async () => {
    const { client, audit } = await connect();

    await client.callTool({ name: "list_customers", arguments: {} });
    const action = { customerId: 1, date: tomorrow, time: "15:00", service: "consultation" };
    const req = await client.callTool({ name: "request_approval", arguments: { tool: "create_booking", args: action } });
    const token = (JSON.parse((req.content as Array<{ text: string }>)[0]?.text ?? "{}") as { token: string }).token;
    await client.callTool({
      name: "create_booking",
      arguments: { ...action, approval: { token, approvedBy: "human-operator" } },
    });

    const entries = audit.all();
    expect(entries.length).toBeGreaterThanOrEqual(3);

    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("read");
    expect(kinds).toContain("approval");
    expect(kinds).toContain("write");

    const write = entries.find((e) => e.tool === "create_booking");
    expect(write?.ok).toBe(true);
    expect(write?.argsPreview).toContain(tomorrow);
  });

  it("blocked writes are audited as failures with the gate reason", async () => {
    const { client, audit } = await connect();

    await client.callTool({
      name: "create_booking",
      arguments: {
        customerId: 1,
        date: tomorrow,
        time: "15:30",
        service: "consultation",
        approval: { token: "deadbeef".repeat(6), approvedBy: "nobody" },
      },
    });

    const blocked = audit.all().find((e) => e.tool === "create_booking" && !e.ok);
    expect(blocked).toBeDefined();
    expect(blocked?.detail).toContain("Unknown approval token");
  });
});
