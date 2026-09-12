import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { IntentSchema, RepayIntentSchema, recipes, type MandateClient, type Plan, type Step } from "@yashjain99/mandate-sdk";

const fmt6 = (s: string) => (Number(s) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function summarizePlan(plan: Plan) {
  return {
    planId: plan.id, venue: plan.venueId, venueExplanation: plan.venueExplanation, account: plan.account,
    collateralEth: (Number(plan.collateralWeth) / 1e18).toFixed(4), projected: plan.projected,
    steps: plan.steps.map((s: Step) => ({ step: s.index, kind: s.kind, chainId: s.chainId, title: s.title, description: s.description, reversible: s.reversible, requiresGuardian: s.requiresGuardian, maxUsdcOut: fmt6(s.maxUsdcOut), status: s.status, txHash: s.txHash, explorer: s.explorer, simulation: s.simulation })),
  };
}

/**
 * Vercel AI SDK tools bound to a MandateClient. Drop into `streamText`/`ToolLoopAgent` together with
 * `mandateToolApproval(client)` so guardian steps pause for a human.
 */
export function mandateTools(client: MandateClient): ToolSet {
  const plan = async (id: string) => (await client.store.plans.get(id)) ?? null;
  return {
    get_positions: tool({
      description: "Read the user's MandateAccount: balances on Base Sepolia and Arc, Compound v3 position (debt, collateral, health factor), mandate caps and remaining daily allowance, guardian and agent addresses. Call this first.",
      inputSchema: z.object({}),
      execute: async () => client.positions(),
    }),
    get_markets: tool({
      description: "Live USDC borrow rates across lending protocols via The Graph's Messari standardized subgraphs (Aave v3, Compound v3, Spark) plus Morpho, ranked for the requested amount. Mainnet rates inform the decision; execution happens on the venue's testnet twin.",
      inputSchema: z.object({ amountUsdc: z.number().positive() }),
      execute: async ({ amountUsdc }) => {
        const { snapshot, ranked } = await client.markets(amountUsdc);
        return {
          fetchedAt: snapshot.fetchedAt,
          table: ranked.table.map((r) => ({ venueId: r.venueId, protocol: r.protocol, network: r.network, market: r.marketName, borrowAprPct: +r.borrowAprPct.toFixed(3), supplyAprPct: +r.supplyAprPct.toFixed(3), utilizationPct: +r.utilizationPct.toFixed(1), availableUsd: Math.round(r.availableUsd), source: r.source, executableOn: r.executable?.network ?? null })),
          cheapestMainnet: ranked.cheapestMainnet?.venueId ?? null, recommended: ranked.recommended?.venueId ?? null, explanation: ranked.explanation, warnings: snapshot.warnings,
        };
      },
    }),
    draft_plan: tool({
      description: "Turn the user's intent into a concrete, deterministic plan (typed steps with calls, reversibility and guardian requirements). Requires get_markets first. Returns the plan with projected health factor and liquidation price.",
      inputSchema: z.object({ intent: IntentSchema }),
      execute: async ({ intent }) => {
        const { ranked } = await client.markets(intent.amountUsdc);
        if (!ranked.recommended) return { error: "no executable venue has enough liquidity for this amount" };
        const p = await recipes.liquidity(client, intent, { venueId: ranked.recommended.venueId, venueExplanation: ranked.explanation, borrowAprPct: ranked.recommended.borrowAprPct });
        return summarizePlan(p);
      },
    }),
    simulate_plan: tool({
      description: "Dry-run a plan against the chain (policy, caps, protocol logic). Steps that depend on earlier steps are checked statically and re-simulated right before execution. Always call before executing.",
      inputSchema: z.object({ planId: z.string() }),
      execute: async ({ planId }) => { const p = await plan(planId); return p ? client.simulate(p) : { error: `unknown plan ${planId}` }; },
    }),
    execute_step: tool({
      description: "Execute one plan step in order. Re-simulates against live state first. Steps flagged requiresGuardian pause for the user's Ledger approval; the signature is attached automatically once the user has signed. Safe to retry: the chain is checked before anything is re-sent. Returns the transaction hash and explorer link.",
      inputSchema: z.object({ planId: z.string(), step: z.number().int().min(1) }),
      execute: async ({ planId, step }) => {
        const p = await plan(planId); if (!p) return { error: `unknown plan ${planId}` };
        const r = await client.execute(p, step);
        if (!r.ok && r.approval) { const { approval, ...rest } = r; return { ...rest, approvalChainId: approval.chainId }; } // text is fetched by the UI, not the model
        return r;
      },
    }),
    check_repayments: tool({
      description: "List repayment intents recorded on the Arc account (due date, amount, done). Use to remind the user or to start a repayment plan.",
      inputSchema: z.object({}),
      execute: async () => { const r = await client.repayments(); return { ...r, repayments: r.repayments.map(({ amountUsdc6, ...x }) => x), currentDebtUsdc6: undefined }; },
    }),
    draft_repayment_plan: tool({
      description: "Plan the reverse leg: bridge USDC back from Arc if needed, repay Compound v3 on Base Sepolia, withdraw freed collateral, close the repayment intent. Then simulate_plan and execute_step as usual.",
      inputSchema: z.object({ intent: RepayIntentSchema }),
      execute: async ({ intent }) => summarizePlan(await recipes.repayment(client, intent)),
    }),
    get_plan: tool({
      description: "Fetch a plan and the status of each step.",
      inputSchema: z.object({ planId: z.string() }),
      execute: async ({ planId }) => { const p = await plan(planId); return p ? summarizePlan(p) : { error: `unknown plan ${planId}` }; },
    }),
    get_audit: tool({
      description: "Read the audit trail (reasoning, transactions, approvals) for a plan or everything.",
      inputSchema: z.object({ planId: z.string().optional() }),
      execute: async ({ planId }) => ({ entries: (await client.store.audit.read(planId)).slice(-40) }),
    }),
  };
}
export type MandateTools = ToolSet;

/** `toolApproval` for streamText / ToolLoopAgent: guardian steps require the user's approval (Ledger) before the tool runs. */
export function mandateToolApproval(client: MandateClient) {
  return {
    execute_step: async ({ planId, step }: { planId: string; step: number }) => {
      const p = await client.store.plans.get(planId);
      const s = p?.steps.find((x) => x.index === step);
      return s?.requiresGuardian && s.status !== "done" ? ("user-approval" as const) : undefined;
    },
  };
}
