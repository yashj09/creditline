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
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMandateFromEnv, fileStore } from "@yashjain99/mandate-sdk";
import { MANDATE_SYSTEM_PROMPT, registerMandateMcpTools } from "@yashjain99/mandate-ai";

// Env: explicit file, else the first .env found walking up from cwd (in-repo runs), else nothing (npx with env vars).
const envFile = process.env.MANDATE_ENV_FILE ?? [".env", "../.env", "../../.env"].map((p) => resolve(process.cwd(), p)).find(existsSync);
if (envFile) loadEnv({ path: envFile, quiet: true });

// Store: explicit dir, else the workspace .data when running in-repo (shared with the web console), else ~/.mandate.
const storeDir = process.env.MANDATE_STORE_DIR ?? [resolve(process.cwd(), ".data"), resolve(process.cwd(), "../../.data")].find(existsSync) ?? resolve(homedir(), ".mandate");

const server = new McpServer({ name: "mandate", version: "0.1.1" }, { instructions: MANDATE_SYSTEM_PROMPT });
// Lazy client: the MCP handshake always succeeds; misconfiguration surfaces as a tool error the model can relay.
registerMandateMcpTools(server, () => createMandateFromEnv({ store: fileStore(storeDir) }));

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
