#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { startHttpServer } from "./transport/http.js";

/**
 * Entry point.
 *
 * Default: stdio transport (for Claude Desktop / Claude Code / any MCP host).
 * Flags:
 *   --http            serve over Streamable HTTP instead of stdio
 *   --port <n>        HTTP port (default 3270)
 *
 * Env:
 *   BOOKINGS_MCP_TOKEN   bearer token required by the HTTP transport
 */

function parseArgs(argv: string[]): { http: boolean; port: number } {
  const args = argv.slice(2);
  const http = args.includes("--http");
  let port = 3270;
  const portIdx = args.indexOf("--port");
  if (portIdx !== -1 && args[portIdx + 1]) {
    const parsed = Number.parseInt(args[portIdx + 1] ?? "", 10);
    if (!Number.isNaN(parsed)) port = parsed;
  }
  return { http, port };
}

async function main(): Promise<void> {
  const { http, port } = parseArgs(process.argv);

  if (http) {
    startHttpServer(port);
    return;
  }

  const { server } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bookings-mcp running over stdio (read/write separation active)");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
