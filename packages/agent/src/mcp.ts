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
export function registerMandateMcpTools(server: McpServerLike, clientOrFactory: MandateClient | (() => MandateClient)) {
  // Lazy: configuration errors (missing env) surface as tool errors instead of crashing before the MCP handshake.
  let cached: MandateClient | undefined;
  const client = () => (cached ??= typeof clientOrFactory === "function" ? clientOrFactory() : clientOrFactory);
  let toolsCache: Record<string, any> | undefined;
  const tools = () => (toolsCache ??= mandateTools(client()) as Record<string, any>);
  const ctx = { toolCallId: "mcp", messages: [] as any[] };
  /** Resolves the tool lazily inside the try so configuration errors come back as `{ error }` like every other failure. */
  const run = async (name: string, input: unknown) => { try { return await tools()[name]!.execute(input, ctx); } catch (e) { return { error: (e as Error).message }; } };

  server.registerTool("get_positions", { description: "Read the user's MandateAccount: balances, Compound position, mandate caps and remaining allowance, guardian and agent. Call this first.", inputSchema: {} }, async () => json(await run("get_positions", {})));
  server.registerTool("get_markets", { description: "Live USDC borrow rates across lending protocols via The Graph standardized subgraphs plus Morpho, ranked for the amount; execution happens on the venue's testnet twin.", inputSchema: { amountUsdc: z.number().positive() } }, async (a) => json(await run("get_markets", a)));
  server.registerTool("draft_plan", { description: "Turn the user's intent into a deterministic plan (typed steps, reversibility, guardian requirements). Requires get_markets first.", inputSchema: { intent: IntentSchema } }, async (a) => json(await run("draft_plan", a)));
  server.registerTool("simulate_plan", { description: "Dry-run a plan against the chain. Dependent steps are checked statically and re-simulated right before execution.", inputSchema: { planId: z.string() } }, async (a) => json(await run("simulate_plan", a)));
  server.registerTool("get_plan", { description: "Fetch a plan and the status of each step.", inputSchema: { planId: z.string() } }, async (a) => json(await run("get_plan", a)));
  server.registerTool("check_repayments", { description: "List repayment intents recorded on the Arc account.", inputSchema: {} }, async () => json(await run("check_repayments", {})));
  server.registerTool("draft_repayment_plan", { description: "Plan the reverse leg: bridge back from Arc if needed, repay Compound, withdraw collateral, close the intent.", inputSchema: { intent: RepayIntentSchema } }, async (a) => json(await run("draft_repayment_plan", a)));
  server.registerTool("get_audit", { description: "Read the audit trail for a plan or everything.", inputSchema: { planId: z.string().optional() } }, async (a) => json(await run("get_audit", a)));
  server.registerTool("prepare_step", {
    description: "Prepare a plan step. Agent-only steps execute immediately. Guardian-gated steps return the exact text the guardian must sign (EIP-191, clear-signed on a Ledger); then call submit_guardian_signature and execute_step.",
    inputSchema: { planId: z.string(), step: z.number().int().min(1) },
  }, async ({ planId, step }) => {
    try {
    const c = client();
    const plan = await c.store.plans.get(planId); const s = plan?.steps.find((x) => x.index === step);
    if (!plan || !s) return json({ error: "unknown plan/step" });
    if (!s.requiresGuardian) return json(await c.execute(plan, step));
    const a = await c.approvals.request(plan, s);
    return json({ requiresGuardian: true, step: { index: s.index, title: s.title, description: s.description }, approval: { text: a.text, guardian: a.guardian, chainId: a.chainId, deadline: a.deadline, nonce: a.nonce }, next: "Have the guardian personal_sign `approval.text`, then call submit_guardian_signature with only the signature." });
    } catch (e) { return json({ error: (e as Error).message }); }
  });
  server.registerTool("submit_guardian_signature", {
    description: "Submit the guardian's EIP-191 signature over the approval text returned by prepare_step. Verified against the server's copy of the text and the on-chain guardian.",
    inputSchema: { planId: z.string(), step: z.number().int().min(1), signature: z.string() },
  }, async (a) => {
    try {
      const c = client();
      const plan = await c.store.plans.get(a.planId); const s = plan?.steps.find((x) => x.index === a.step);
      if (!plan || !s) return json({ error: "unknown plan/step" });
      await c.approvals.submit(plan, s, a.signature as Hex, "mcp"); return json({ ok: true, next: "call execute_step" });
    } catch (e) { return json({ error: (e as Error).message }); }
  });
  server.registerTool("execute_step", { description: "Execute one plan step in order; guardian steps need a stored signature (prepare_step \u2192 submit_guardian_signature). Safe to retry.", inputSchema: { planId: z.string(), step: z.number().int().min(1) } }, async (a) => json(await run("execute_step", a)));
  return { instructions: MANDATE_SYSTEM_PROMPT };
}
