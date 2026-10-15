import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer, type ServerDeps } from "../server.js";

/**
 * Streamable HTTP transport (stateless mode).
 *
 * - One server + transport instance PER REQUEST: no session state shared
 *   across callers.
 * - Optional bearer-token auth via BOOKINGS_MCP_TOKEN env var. If unset,
 *   the server binds to localhost only and logs a loud warning — never
 *   expose an unauthenticated instance beyond localhost.
 */
export function startHttpServer(port: number, deps: ServerDeps = {}): void {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const authToken = process.env.BOOKINGS_MCP_TOKEN;

  app.use("/mcp", (req, res, next) => {
    if (!authToken) {
      if (req.socket.remoteAddress && !isLocal(req.socket.remoteAddress)) {
        res.status(403).json({ error: "Server has no token configured and only accepts localhost clients." });
        return;
      }
      next();
      return;
    }
    const header = req.headers.authorization;
    if (header !== `Bearer ${authToken}`) {
      res.status(401).json({ error: "Missing or invalid Authorization bearer token." });
      return;
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    const { server } = buildServer(deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: no session id, no sticky state
      enableJsonResponse: true,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[http] request failed:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    }
  });

  // Stateless mode: sessions are not supported.
  app.get("/mcp", (_req, res) => res.status(405).json({ error: "Session support disabled (stateless mode)" }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Session support disabled (stateless mode)" }));

  app.listen(port, "127.0.0.1", () => {
    console.error(`bookings-mcp (Streamable HTTP) listening on http://127.0.0.1:${port}/mcp`);
    if (!authToken) {
      console.error("WARNING: BOOKINGS_MCP_TOKEN is not set — bound to localhost only. Set it before exposing this server.");
    }
  });
}

function isLocal(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
