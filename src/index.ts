import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { Request, Response, NextFunction } from "express";
import { loadConfig } from "./config.js";
import { InstagramClient } from "./instagram/client.js";
import { createInstagramMcpServer } from "./mcp-server.js";

const config = loadConfig();
const instagram = new InstagramClient(config);

// Bind 0.0.0.0 for remote deployment. Localhost-only DNS rebinding
// protection is disabled when host is not loopback.
const app = createMcpExpressApp({ host: "0.0.0.0" });

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "instagram-claude-mcp",
    mode: "read-only",
  });
});

if (config.mcpAuthToken) {
  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;

    if (token !== config.mcpAuthToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });
}

async function handleMcp(req: Request, res: Response): Promise<void> {
  // Stateless Streamable HTTP: fresh server + transport per request.
  const server = createInstagramMcpServer(instagram);
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

app.post("/mcp", (req, res) => {
  void handleMcp(req, res);
});

app.get("/mcp", (req, res) => {
  void handleMcp(req, res);
});

app.delete("/mcp", (req, res) => {
  void handleMcp(req, res);
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`instagram-claude-mcp listening on port ${config.port}`);
  console.log(`Health: GET /health`);
  console.log(`MCP:    POST/GET/DELETE /mcp (Streamable HTTP)`);
});
