import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and set your credentials.`,
    );
  }
  return value;
}

export type AppConfig = {
  accessToken: string;
  accountId: string;
  graphApiBase: string;
  apiVersion: string;
  port: number;
  mcpAuthToken: string | undefined;
};

export function loadConfig(): AppConfig {
  const graphApiBase = (
    process.env.INSTAGRAM_GRAPH_API_BASE?.trim() ||
    "https://graph.facebook.com"
  ).replace(/\/$/, "");

  const apiVersion = (
    process.env.INSTAGRAM_API_VERSION?.trim() || "v22.0"
  ).replace(/^\/*/, "");

  return {
    accessToken: requireEnv("INSTAGRAM_ACCESS_TOKEN"),
    accountId: requireEnv("INSTAGRAM_ACCOUNT_ID"),
    graphApiBase,
    apiVersion,
    port: Number(process.env.PORT) || 3000,
    mcpAuthToken: process.env.MCP_AUTH_TOKEN?.trim() || undefined,
  };
}

export function getApiRoot(config: AppConfig): string {
  return `${config.graphApiBase}/${config.apiVersion}`;
}
