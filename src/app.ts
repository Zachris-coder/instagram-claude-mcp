import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { loadConfig, type AppConfig } from "./config.js";
import { InstagramClient } from "./instagram/client.js";
import { createInstagramMcpServer } from "./mcp-server.js";

let cachedConfig: AppConfig | undefined;
let cachedClient: InstagramClient | undefined;

function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

function getInstagramClient(): InstagramClient {
  if (!cachedClient) {
    cachedClient = new InstagramClient(getConfig());
  }
  return cachedClient;
}

/**
 * Express app used for local Node hosting and Vercel serverless.
 * Do not call app.listen() here — the entrypoint decides that.
 */
export function createApp(): express.Express {
  // Bind 0.0.0.0 for remote deployment. Localhost-only DNS rebinding
  // protection is disabled when host is not loopback.
  // `express` is imported so Vercel can detect the Express framework entry.
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      service: "instagram-claude-mcp",
      mode: "read-only",
    });
  });

  /**
   * Temporary safe auth diagnostic.
   * Never returns or logs the full access token.
   */
  app.get("/debug-instagram-auth", async (_req: Request, res: Response) => {
    try {
      const client = getInstagramClient();
      const result = await client.debugAuth();
      res.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Config/load errors only — never include secrets.
      res.status(500).json({
        ok: false,
        error: message,
      });
    }
  });

  /** Safe test for get_instagram_profile (same client path as the MCP tool). */
  app.get("/debug-instagram-profile", async (_req: Request, res: Response) => {
    try {
      const client = getInstagramClient();
      const result = await client.debugProfile();
      res.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  /** Safe test for list_instagram_media (uses /me.user_id as <IG_ID>). */
  app.get("/debug-instagram-media", async (_req: Request, res: Response) => {
    try {
      const client = getInstagramClient();
      const result = await client.debugListMedia(5);
      res.status(result.ok ? 200 : 502).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  /**
   * Exchange a short-lived Instagram Login user token for a long-lived token.
   * Requires INSTAGRAM_APP_SECRET. If MCP_AUTH_TOKEN is set, Bearer auth is required.
   * Response includes the new token once so you can update Vercel env — treat as secret.
   */
  app.post(
    "/exchange-instagram-token",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const config = getConfig();
        if (config.mcpAuthToken) {
          const header = req.headers.authorization;
          const token = header?.startsWith("Bearer ")
            ? header.slice("Bearer ".length).trim()
            : undefined;
          if (token !== config.mcpAuthToken) {
            res.status(401).json({ error: "Unauthorized" });
            return;
          }
        }
        next();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
      }
    },
    async (_req: Request, res: Response) => {
      try {
        const client = getInstagramClient();
        const result = await client.exchangeForLongLivedToken();
        res.status(result.ok ? 200 : 502).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ ok: false, error: message });
      }
    },
  );

  app.use("/mcp", (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = getConfig();
      if (!config.mcpAuthToken) {
        next();
        return;
      }

      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : undefined;

      if (token !== config.mcpAuthToken) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  async function handleMcp(req: Request, res: Response): Promise<void> {
    let client: InstagramClient;
    try {
      client = getInstagramClient();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
      return;
    }

    // Stateless Streamable HTTP: fresh server + transport per request.
    // Compatible with Vercel serverless (no sticky sessions required).
    const server = createInstagramMcpServer(client);
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

  return app;
}

const app = createApp();
export default app;
