# instagram-claude-mcp

Remote MCP server that connects Claude to the **official Meta Instagram Graph API** (read-only).

Exposes Instagram profile, media, insights, and comments as MCP tools over **Streamable HTTP**, so Claude can call them via an HTTPS MCP URL.

## Features

| Tool | Description |
|------|-------------|
| `get_instagram_profile` | Connected Instagram professional account profile |
| `list_instagram_media` | Recent posts / reels / carousels |
| `get_instagram_media` | Details for a specific media item |
| `get_instagram_insights` | Account-level or media-level insights |
| `get_instagram_comments` | Comments (and replies when available) on a media item |

**Not implemented (by design):** publishing, deleting, messaging, comment replies, or any write operations.

## Requirements

- Node.js 20+
- An Instagram **professional** account (Business or Creator)
- A Meta app with Instagram Graph API access
- A long-lived access token with read permissions for the account
- The Instagram account ID (`IG User ID`)

## Environment variables

Copy `.env.example` to `.env` and fill in values locally. Never commit `.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `INSTAGRAM_ACCESS_TOKEN` | Yes | Long-lived Instagram Graph API access token |
| `INSTAGRAM_ACCOUNT_ID` | Yes | Instagram professional account ID |
| `INSTAGRAM_GRAPH_API_BASE` | No | Default `https://graph.facebook.com`. Use `https://graph.instagram.com` for Instagram Login tokens |
| `INSTAGRAM_API_VERSION` | No | Default `v22.0` |
| `PORT` | No | HTTP port (default `3000`) |
| `MCP_AUTH_TOKEN` | No | If set, `/mcp` requires `Authorization: Bearer <token>` |

## Local development

```bash
npm install
cp .env.example .env
# Edit .env with INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_ACCOUNT_ID

npm run dev
# or
npm run build && npm start
```

Endpoints:

- Health: `GET http://localhost:3000/health`
- MCP (Streamable HTTP): `http://localhost:3000/mcp`

Type-check without running:

```bash
npm run typecheck
```

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Connect with transport **Streamable HTTP** and URL `http://localhost:3000/mcp`.

## Deploy as a remote MCP server

### Vercel (serverless Express)

This project is set up for Vercel’s Express runtime: the app is **exported as a default Express handler** and only calls `app.listen()` when **not** running on Vercel (`VERCEL=1`). That matches serverless invocation — there is no permanently running Node process in production.

1. Import the GitHub repo in Vercel (or run `vercel`).
2. Set Project Environment Variables (Production/Preview):
   - `INSTAGRAM_ACCESS_TOKEN`
   - `INSTAGRAM_ACCOUNT_ID`
   - Optional: `MCP_AUTH_TOKEN`, `INSTAGRAM_GRAPH_API_BASE`, `INSTAGRAM_API_VERSION`
3. Deploy. Endpoints stay the same:
   - `https://your-app.vercel.app/health`
   - `https://your-app.vercel.app/mcp` (Streamable HTTP)

`vercel.json` pins the Express framework, runs `npm run build`, and sets function `maxDuration` to 60s for Graph API calls. MCP handling is **stateless** (fresh transport per request), which is compatible with Vercel Functions / Fluid compute.

Claude connector URL example:

```text
https://your-app.vercel.app/mcp
```

### Other Node hosts (Railway, Render, Fly.io, Cloud Run, etc.)

1. Push this repo and deploy as a normal Node service.
2. Set the same secret environment variables in the host dashboard.
3. The process runs `npm start` → `node dist/index.js`, which listens on `PORT`.

```bash
npm install
npm run build
npm start
```

## Connect from Claude

### Claude (web / desktop connectors)

Add a custom connector with your HTTPS MCP URL, for example:

```text
https://your-service.example.com/mcp
```

If you set `MCP_AUTH_TOKEN`, configure the matching bearer token in the connector settings when supported.

### Claude Code

```bash
claude mcp add --transport http instagram-claude-mcp https://your-service.example.com/mcp
```

### Cursor

Add to `.cursor/mcp.json` (or your MCP config):

```json
{
  "mcpServers": {
    "instagram-claude-mcp": {
      "url": "https://your-service.example.com/mcp"
    }
  }
}
```

## Instagram API notes

- Uses only the official Meta Graph API (`graph.facebook.com` or `graph.instagram.com`).
- Credentials are read from environment variables only — never hardcoded.
- Insights metrics and periods depend on Meta’s current Insights API rules (metric availability differs for account vs media, and by media product type). Pass the metrics Meta documents for your use case via the `metrics` tool argument.
- Tokens expire; rotate long-lived tokens as needed in your host’s secret store.

## Project layout

```text
src/
  app.ts                # Express app factory (/health, /mcp) — default-exported for Vercel
  index.ts              # Entry: export app; listen only when not on Vercel
  config.ts             # Environment configuration
  mcp-server.ts         # MCP tool registration
  instagram/client.ts   # Official Graph API client (read-only)
vercel.json             # Vercel Express + function limits
```

## License

MIT
