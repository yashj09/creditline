#!/usr/bin/env tsx
/**
 * Mandate MCP server — lets Claude Desktop / Claude Code be the agent, using the exact same tools as the web console.
 *
 * MCP tool calls are request/response, so the guardian pause is explicit:
 *   prepare_step  → returns the approval text (for guardian steps) or executes immediately (agent-only steps)
 *   submit_guardian_signature → stores the Ledger signature
 *   execute_step  → runs the step (uses the stored signature when required)
 *
 * Run:  pnpm --filter @mandate/mcp start          (stdio, for Claude Desktop)
 *       pnpm --filter @mandate/mcp start:http     (streamable HTTP on :3111)
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Hex } from "viem";
import { IntentSchema, RepayIntentSchema } from "@mandate/core";
import { SYSTEM_PROMPT, acceptGuardianSignature, getOrBuildApproval, plans, tools } from "@mandate/agent";

const server = new McpServer({ name: "mandate", version: "0.1.0" }, { instructions: SYSTEM_PROMPT });

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });
const ctx = { toolCallId: "mcp", messages: [] as any[] };
const run = (t: any, input: unknown) => t.execute(input, ctx);
const desc = (t: any): string => (typeof t.description === "function" ? t.description({ context: {} }) : String(t.description ?? ""));

server.registerTool("get_positions", { description: desc(tools.get_positions), inputSchema: {} }, async () => json(await run(tools.get_positions, {})));
server.registerTool("get_markets", { description: desc(tools.get_markets), inputSchema: { amountUsdc: z.number().positive() } }, async (a) => json(await run(tools.get_markets, a)));
server.registerTool("draft_plan", { description: desc(tools.draft_plan), inputSchema: { intent: IntentSchema } }, async (a) => json(await run(tools.draft_plan, a)));
server.registerTool("simulate_plan", { description: desc(tools.simulate_plan), inputSchema: { planId: z.string() } }, async (a) => json(await run(tools.simulate_plan, a)));
server.registerTool("get_plan", { description: desc(tools.get_plan), inputSchema: { planId: z.string() } }, async (a) => json(await run(tools.get_plan, a)));
server.registerTool("check_repayments", { description: desc(tools.check_repayments), inputSchema: {} }, async () => json(await run(tools.check_repayments, {})));
server.registerTool("draft_repayment_plan", { description: desc(tools.draft_repayment_plan), inputSchema: { intent: RepayIntentSchema } }, async (a) => json(await run(tools.draft_repayment_plan, a)));
server.registerTool("get_audit", { description: desc(tools.get_audit), inputSchema: { planId: z.string().optional() } }, async (a) => json(await run(tools.get_audit, a)));

server.registerTool(
  "prepare_step",
  {
    description:
      "Prepare a plan step. For agent-only steps this executes immediately. For guardian-gated steps it returns the exact text the user must sign on their Ledger (EIP-191); then call submit_guardian_signature and execute_step.",
    inputSchema: { planId: z.string(), step: z.number().int().min(1) },
  },
  async ({ planId, step }) => {
    const plan = plans.get(planId);
    const s = plan?.steps.find((x) => x.index === step);
    if (!plan || !s) return json({ error: "unknown plan/step" });
    if (!s.requiresGuardian) return json(await run(tools.execute_step, { planId, step }));
    const a = await getOrBuildApproval(plan, s);
    return json({ requiresGuardian: true, step: { index: s.index, title: s.title, description: s.description }, approval: { text: a.text, guardian: a.guardian, chainId: a.chainId, deadline: a.deadline, nonce: a.nonce }, next: "Have the guardian sign `approval.text` with personal_sign (a Ledger clear-signs it), then call submit_guardian_signature with only the signature." });
  },
);

server.registerTool(
  "submit_guardian_signature",
  {
    description: "Submit the guardian's EIP-191 signature over the approval text returned by prepare_step. The server verifies it against its own copy of the text and the on-chain guardian.",
    inputSchema: { planId: z.string(), step: z.number().int().min(1), signature: z.string() },
  },
  async (a) => {
    const plan = plans.get(a.planId);
    const s = plan?.steps.find((x) => x.index === a.step);
    if (!plan || !s) return json({ error: "unknown plan/step" });
    try {
      await acceptGuardianSignature(plan, s, a.signature as Hex, "mcp");
      plans.save(plan);
      return json({ ok: true, next: "call execute_step" });
    } catch (e) {
      return json({ error: (e as Error).message });
    }
  },
);

server.registerTool("execute_step", { description: desc(tools.execute_step), inputSchema: { planId: z.string(), step: z.number().int().min(1) } }, async (a) => json(await run(tools.execute_step, a)));

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
  app.listen(port, () => console.error(`mandate mcp (streamable http) on http://localhost:${port}/mcp`));
} else {
  await server.connect(new StdioServerTransport());
}
