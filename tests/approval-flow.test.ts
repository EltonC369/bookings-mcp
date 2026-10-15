import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connect, tomorrow } from "./read-write-separation.test.js";

/** Helper: mint a real approval via request_approval and return the payload. */
async function mintApproval(
  client: Client,
  tool: "create_booking" | "cancel_booking",
  args: Record<string, unknown>,
): Promise<{ token: string; approvedBy: string }> {
  const result = await client.callTool({
    name: "request_approval",
    arguments: { tool, args },
  });
  expect(result.isError).toBeFalsy();
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "{}";
  const parsed = JSON.parse(text) as { token: string };
  return { token: parsed.token, approvedBy: "human-operator" };
}

describe("approval gate", () => {
  it("happy path: approval minted with exact args lets the write through", async () => {
    const { client, store } = await connect();
    const action = { customerId: 1, date: tomorrow, time: "11:00", service: "consultation" };
    const approval = await mintApproval(client, "create_booking", action);

    const result = await client.callTool({
      name: "create_booking",
      arguments: { ...action, approval },
    });
    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "{}";
    const booking = JSON.parse(text) as { id: number; status: string };
    expect(booking.status).toBe("confirmed");
    expect(store.getBooking(booking.id)).toBeDefined();
  });

  it("changing ANY argument after approval invalidates the token", async () => {
    const { client } = await connect();
    const action = { customerId: 1, date: tomorrow, time: "11:30", service: "consultation" };
    const approval = await mintApproval(client, "create_booking", action);

    // Attacker (or drifted agent) changes the time after the human approved 11:30.
    const tampered = { ...action, time: "12:00" };
    const result = await client.callTool({
      name: "create_booking",
      arguments: { ...tampered, approval },
    });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("Arguments changed after approval");
  });

  it("an approval for one tool cannot be replayed against another tool", async () => {
    const { client } = await connect();
    const action = { customerId: 1, date: tomorrow, time: "12:30", service: "follow-up" };
    const approval = await mintApproval(client, "create_booking", action);

    const result = await client.callTool({
      name: "cancel_booking",
      arguments: { bookingId: 1, approval },
    });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.content);
    expect(text).toContain("issued for tool 'create_booking'");
  });

  it("tokens are single-use: a second call with the same token fails", async () => {
    const { client } = await connect();
    const action = { customerId: 2, date: tomorrow, time: "13:00", service: "consultation" };
    const approval = await mintApproval(client, "create_booking", action);

    const first = await client.callTool({ name: "create_booking", arguments: { ...action, approval } });
    expect(first.isError).toBeFalsy();

    const replay = await client.callTool({ name: "create_booking", arguments: { ...action, approval } });
    expect(replay.isError).toBe(true);
    const text = JSON.stringify(replay.content);
    expect(text).toContain("Unknown approval token");
  });

  it("business rule still applies after the gate: double-booking a taken slot fails", async () => {
    const { client } = await connect();
    const action = { customerId: 3, date: tomorrow, time: "09:00", service: "consultation" };
    const approval = await mintApproval(client, "create_booking", action);
    const result = await client.callTool({ name: "create_booking", arguments: { ...action, approval } });
    // 09:00 tomorrow may be free; if free it books; then a second approval for same slot must fail.
    if (result.isError) {
      const text = JSON.stringify(result.content);
      expect(text).toContain("already taken");
    } else {
      const approval2 = await mintApproval(client, "create_booking", action);
      const second = await client.callTool({ name: "create_booking", arguments: { ...action, approval: approval2 } });
      expect(second.isError).toBe(true);
      const text = JSON.stringify(second.content);
      expect(text).toContain("already taken");
    }
  });
});
