import type { Hex } from "viem";
import { z } from "zod";
import { IntentSchema, RepayIntentSchema, type MandateClient } from "@yashjain99/mandate-sdk";
import { mandateTools } from "./tools.ts";
import { MANDATE_SYSTEM_PROMPT } from "./system-prompt.ts";

type McpServerLike = { registerTool: (name: string, cfg: { description: string; inputSchema: Record<string, any> }, handler: (args: any) => Promise<any>) => unknown };

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });

/**
 * Registers Mandate's tools on any MCP server. MCP calls are request/response, so the guardian pause is explicit:
 *   prepare_step → approval text (guardian steps) or immediate execution (agent-only steps)
 *   submit_guardian_signature → store the guardian's signature (verified against the server-built text)
 *   execute_step → run the step
 */
export function registerMandateMcpTools(server: McpServerLike, client: MandateClient) {
  const t = mandateTools(client) as Record<string, any>;
  const ctx = { toolCallId: "mcp", messages: [] as any[] };
  const run = (x: any, input: unknown) => x.execute(input, ctx);
  const desc = (x: any): string => (typeof x.description === "function" ? x.description({ context: {} }) : String(x.description ?? ""));

  server.registerTool("get_positions", { description: desc(t.get_positions), inputSchema: {} }, async () => json(await run(t.get_positions!, {})));
  server.registerTool("get_markets", { description: desc(t.get_markets), inputSchema: { amountUsdc: z.number().positive() } }, async (a) => json(await run(t.get_markets, a)));
  server.registerTool("draft_plan", { description: desc(t.draft_plan), inputSchema: { intent: IntentSchema } }, async (a) => json(await run(t.draft_plan, a)));
  server.registerTool("simulate_plan", { description: desc(t.simulate_plan), inputSchema: { planId: z.string() } }, async (a) => json(await run(t.simulate_plan, a)));
  server.registerTool("get_plan", { description: desc(t.get_plan), inputSchema: { planId: z.string() } }, async (a) => json(await run(t.get_plan, a)));
  server.registerTool("check_repayments", { description: desc(t.check_repayments), inputSchema: {} }, async () => json(await run(t.check_repayments, {})));
  server.registerTool("draft_repayment_plan", { description: desc(t.draft_repayment_plan), inputSchema: { intent: RepayIntentSchema } }, async (a) => json(await run(t.draft_repayment_plan, a)));
  server.registerTool("get_audit", { description: desc(t.get_audit), inputSchema: { planId: z.string().optional() } }, async (a) => json(await run(t.get_audit, a)));
  server.registerTool("prepare_step", {
    description: "Prepare a plan step. Agent-only steps execute immediately. Guardian-gated steps return the exact text the guardian must sign (EIP-191, clear-signed on a Ledger); then call submit_guardian_signature and execute_step.",
    inputSchema: { planId: z.string(), step: z.number().int().min(1) },
  }, async ({ planId, step }) => {
    const plan = await client.store.plans.get(planId); const s = plan?.steps.find((x) => x.index === step);
    if (!plan || !s) return json({ error: "unknown plan/step" });
    if (!s.requiresGuardian) return json(await client.execute(plan, step));
    const a = await client.approvals.request(plan, s);
    return json({ requiresGuardian: true, step: { index: s.index, title: s.title, description: s.description }, approval: { text: a.text, guardian: a.guardian, chainId: a.chainId, deadline: a.deadline, nonce: a.nonce }, next: "Have the guardian personal_sign `approval.text`, then call submit_guardian_signature with only the signature." });
  });
  server.registerTool("submit_guardian_signature", {
    description: "Submit the guardian's EIP-191 signature over the approval text returned by prepare_step. Verified against the server's copy of the text and the on-chain guardian.",
    inputSchema: { planId: z.string(), step: z.number().int().min(1), signature: z.string() },
  }, async (a) => {
    const plan = await client.store.plans.get(a.planId); const s = plan?.steps.find((x) => x.index === a.step);
    if (!plan || !s) return json({ error: "unknown plan/step" });
    try { await client.approvals.submit(plan, s, a.signature as Hex, "mcp"); return json({ ok: true, next: "call execute_step" }); } catch (e) { return json({ error: (e as Error).message }); }
  });
  server.registerTool("execute_step", { description: desc(t.execute_step), inputSchema: { planId: z.string(), step: z.number().int().min(1) } }, async (a) => json(await run(t.execute_step, a)));
  return { instructions: MANDATE_SYSTEM_PROMPT };
}
