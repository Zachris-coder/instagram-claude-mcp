import app from "./app.js";
import { loadConfig } from "./config.js";

// Re-export for Vercel Express detection (`src/index.ts` default export).
export default app;

/**
 * Local / long-running hosts call listen().
 * On Vercel, VERCEL=1 and the platform invokes the exported Express app
 * as a serverless function — do not start a permanent listener there.
 */
const isVercel = process.env.VERCEL === "1";

if (!isVercel) {
  const config = loadConfig();
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`instagram-claude-mcp listening on port ${config.port}`);
    console.log(`Health: GET /health`);
    console.log(`MCP:    POST/GET/DELETE /mcp (Streamable HTTP)`);
  });
}
