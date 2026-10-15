#!/usr/bin/env node
/**
 * demo-client.ts — End-to-end demo of the bookings-mcp approval gate.
 *
 * This script is a STORY, told in five scenes, of how a safe agentic
 * booking workflow behaves:
 *
 *   Scene 1  Discovery   — tools/list, showing the read/write split
 *   Scene 2  Free reads  — list_customers + check_availability (no gate)
 *   Scene 3  Happy path  — request_approval → human approves → create_booking
 *   Scene 4  Attack #1   — approved for "12:00", submitted as "13:00" → BLOCKED
 *   Scene 5  Attack #2   — replay of the (single-use) Scene-3 token → BLOCKED
 *
 * It spawns the real compiled server (dist/index.js) over stdio and talks to
 * it through the official MCP client SDK. The server's audit log goes to
 * stderr, which we route to /dev/null so the demo output stays readable.
 *
 * Run it with:  npm run demo
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Absolute path to the repo root, resolved from this file's location. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENTRY = path.join("dist", "index.js");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** YYYY-MM-DD for `daysAhead` days from today, computed in local time. */
function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Small helpers over the SDK's (deliberately loose) result types
// ---------------------------------------------------------------------------

interface LooseResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** Extract the concatenated text blocks of a tool result. */
function textOf(result: LooseResult): string {
  return result.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** Call a tool and parse its JSON text payload. */
async function callJson<T>(client: Client, name: string, args?: Record<string, unknown>): Promise<{ data: T; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as LooseResult;
  return { data: JSON.parse(textOf(result)) as T, isError: result.isError === true };
}

function banner(title: string): void {
  console.log("\n" + "─".repeat(74));
  console.log(title);
  console.log("─".repeat(74));
}

function line(text = ""): void {
  console.log(text);
}

// ---------------------------------------------------------------------------
// The demo
// ---------------------------------------------------------------------------

interface Customer {
  id: number;
  name: string;
  phone: string;
}
interface Slot {
  date: string;
  time: string;
  available: boolean;
}
interface Booking {
  id: number;
  customerId: number;
  date: string;
  time: string;
  service: string;
  status: string;
}
interface ApprovalResponse {
  token: string;
  boundTo: { tool: string; args: Record<string, unknown> };
  expiresAt: string;
}

async function main(): Promise<void> {
  const DATE = futureDate(7); // 7 days out — always clear of the seed bookings
  const REVIEWER = "Dana Ruiz (human reviewer)";

  line();
  line("🛡️  bookings-mcp — approval gate demo");
  line(`   target date for all scenes: ${DATE} (7 days from today)`);
  line(`   server: node ${SERVER_ENTRY} (spawned over stdio)`);

  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    cwd: REPO_ROOT,
    stderr: "ignore", // the audit log lives on stderr; keep the demo clean
  });
  const client = new Client({ name: "demo-client", version: "1.0.0" });
  await client.connect(transport);

  // -------------------------------------------------------------------------
  // Scene 1 — tools/list: what does this server expose?
  // -------------------------------------------------------------------------
  banner("📖  SCENE 1 · tools/list — capability discovery");
  const { tools } = await client.listTools();
  line(`   ${tools.length} tools advertised:`);
  line();
  line(`   ${"tool".padEnd(20)}${"read-only".padEnd(11)}description`);
  line(`   ${"-".repeat(19)} ${"-".repeat(8)}  ${"-".repeat(38)}`);
  for (const tool of tools) {
    const ro = tool.annotations?.readOnlyHint === true ? "yes ✅" : "no  ⛔";
    const desc = (tool.description ?? "").split(".")[0] ?? "";
    line(`   ${tool.name.padEnd(20)}${ro.padEnd(11)}${desc.slice(0, 38)}`);
  }
  line();
  line("   → reads are free to call; writes demand an approval payload.");

  // -------------------------------------------------------------------------
  // Scene 2 — reads with no gate: customers + availability
  // -------------------------------------------------------------------------
  banner("📖  SCENE 2 · free reads — list_customers + check_availability");
  const { data: customers } = await callJson<Customer[]>(client, "list_customers");
  line("   list_customers:");
  for (const c of customers) line(`     #${c.id}  ${c.name.padEnd(14)} ${c.phone}`);

  const { data: slots } = await callJson<Slot[]>(client, "check_availability", {
    date: DATE,
    times: ["09:00", "09:30", "10:00"],
  });
  line(`   check_availability ${DATE}:`);
  line(
    "     " +
      slots.map((s) => `${s.time} ${s.available ? "✅ free" : "⛔ taken"}`).join("   "),
  );
  line();
  line("   → no token was needed: reads never touch the approval gate.");

  // -------------------------------------------------------------------------
  // Scene 3 — the happy path: approve → book
  // -------------------------------------------------------------------------
  banner("✅  SCENE 3 · happy path — request_approval → human → create_booking");
  const scene3Args = { customerId: 2, date: DATE, time: "11:00", service: "follow-up" };

  line(`   agent: request_approval for create_booking ${JSON.stringify({ ...scene3Args })}`);
  const { data: approval } = await callJson<ApprovalResponse>(client, "request_approval", {
    tool: "create_booking",
    args: scene3Args,
  });
  line(`   minted token ${approval.token.slice(0, 12)}…`);
  line(`   bound to:   ${approval.boundTo.tool} ${JSON.stringify(approval.boundTo.args)}`);
  line(`   expires at: ${approval.expiresAt}`);
  line();

  line("   👩‍💼  human reviewer is inspecting the pending action…");
  await sleep(800); // simulate a human looking at the request
  line(`   👩‍💼  ${REVIEWER} says "looks good" — token released to the agent.`);
  line();

  const { data: booking, isError } = await callJson<Booking>(client, "create_booking", {
    ...scene3Args,
    approval: { token: approval.token, approvedBy: REVIEWER },
  });
  if (isError) throw new Error(`Scene 3 failed: ${JSON.stringify(booking)}`);
  const who = customers.find((c) => c.id === booking.customerId)?.name ?? "?";
  line("   ✅ booking created:");
  line(`        id       : #${booking.id}`);
  line(`        customer : #${booking.customerId} (${who})`);
  line(`        when     : ${booking.date} @ ${booking.time} (30-min slot)`);
  line(`        service  : ${booking.service}`);
  line(`        status   : ${booking.status}`);

  // -------------------------------------------------------------------------
  // Scene 4 — attack #1: swap an argument after approval
  // -------------------------------------------------------------------------
  banner("⛔  SCENE 4 · attack #1 — argument swapped after approval");
  const scene4Approved = { customerId: 2, date: DATE, time: "12:00", service: "follow-up" };
  const { data: approval4 } = await callJson<ApprovalResponse>(client, "request_approval", {
    tool: "create_booking",
    args: scene4Approved,
  });
  line(`   approved for time "12:00" (token ${approval4.token.slice(0, 12)}…)`);
  line('   …but the agent sneaks time "13:00" into the actual call:');

  const result4 = (await client.callTool({
    name: "create_booking",
    arguments: {
      customerId: 2,
      date: DATE,
      time: "13:00", // ← differs from the approved 12:00
      service: "follow-up",
      approval: { token: approval4.token, approvedBy: REVIEWER },
    },
  })) as LooseResult;
  line(`   ⛔ server says: ${textOf(result4)}`);
  line("   → the token is hash-bound to the exact arguments; tampering voids it.");

  // -------------------------------------------------------------------------
  // Scene 5 — attack #2: replay the already-consumed Scene-3 token
  // -------------------------------------------------------------------------
  banner("⛔  SCENE 5 · attack #2 — replaying the spent Scene-3 token");
  line(`   reusing token ${approval.token.slice(0, 12)}… for an identical booking:`);

  const result5 = (await client.callTool({
    name: "create_booking",
    arguments: {
      ...scene3Args, // byte-for-byte identical to the approved action…
      approval: { token: approval.token, approvedBy: REVIEWER }, // …but the token is spent
    },
  })) as LooseResult;
  line(`   ⛔ server says: ${textOf(result5)}`);
  line("   → tokens are single-use; a replay can never double-apply.");

  // -------------------------------------------------------------------------
  // Summary + teardown
  // -------------------------------------------------------------------------
  const blocked4 = textOf(result4).includes("BLOCKED BY APPROVAL GATE");
  const blocked5 = textOf(result5).includes("BLOCKED BY APPROVAL GATE");
  banner("🛡️  demo summary");
  line(`   Scene 3 write executed with a valid approval .......... ${booking.status === "confirmed" ? "✅" : "❌"}`);
  line(`   Scene 4 argument-tamper blocked ...................... ${blocked4 ? "✅" : "❌"}`);
  line(`   Scene 5 token replay blocked ........................ ${blocked5 ? "✅" : "❌"}`);
  line();
  line("   The only write that landed is the one a human signed off on.");
  line();

  await client.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\n💥 demo failed:", err);
  process.exit(1);
});
