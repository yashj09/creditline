/**
 * mandate-mcp — MCP server that lets Claude Desktop / Cursor / any MCP client operate a Mandate account.
 *
 *   npx @yashjain99/mandate-mcp            (stdio)
 *   npx @yashjain99/mandate-mcp --http 3111
 *
 * Env: MANDATE_ACCOUNT, BASE_SEPOLIA_RPC / ARC_TESTNET_RPC (optional), AGENT_PRIVATE_KEY or CIRCLE_*,
 *      MANDATE_STORE_DIR (default ~/.mandate), GRAPH_API_KEY, MANDATE_GUARDIAN_KEY (dev only), MANDATE_ENV_FILE (optional .env path)
 */
import { config as loadEnv } from "dotenv";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMandateFromEnv, fileStore } from "@yashjain99/mandate-sdk";
import { MANDATE_SYSTEM_PROMPT, registerMandateMcpTools } from "@yashjain99/mandate-ai";

loadEnv({ path: process.env.MANDATE_ENV_FILE ?? resolve(process.cwd(), ".env"), quiet: true });

const client = createMandateFromEnv({ store: fileStore(process.env.MANDATE_STORE_DIR ?? resolve(homedir(), ".mandate")) });
const server = new McpServer({ name: "mandate", version: "0.1.0" }, { instructions: MANDATE_SYSTEM_PROMPT });
registerMandateMcpTools(server, client);

const httpIdx = process.argv.indexOf("--http");
if (httpIdx >= 0) {
  const port = Number(process.argv[httpIdx + 1] ?? 3111);
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.all("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.listen(port, () => console.error(`mandate-mcp (streamable http) on http://localhost:${port}/mcp`));
} else {
  await server.connect(new StdioServerTransport());
}
