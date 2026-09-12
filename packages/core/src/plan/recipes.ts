import { parseUnits, type Address } from "viem";
import { ARC_TESTNET, BASE_SEPOLIA } from "../addresses.ts";
import type { ActionRequest } from "../actions/types.ts";
import type { MandateClient } from "../client.ts";
import { readCometPosition } from "../exec/compound.ts";
import { usdcBalance } from "../exec/cctp.ts";
import type { Intent, Plan, RepayIntent } from "./schema.ts";

/**
 * Recipes compose built-in actions into the two flows the reference app ships. They are ordinary `client.plan` calls —
 * copy one to build your own flow from adapters.
 */
export const recipes = {
  /** Borrow USDC against ETH on Compound v3 (Base Sepolia) → CCTP to Arc → optional payment → schedule repayment. */
  async liquidity(client: MandateClient, intent: Intent, opts: { id?: string; venueId?: string; venueExplanation?: string; borrowAprPct?: number; targetHealth?: number } = {}): Promise<Plan> {
    const amount = parseUnits(intent.amountUsdc.toString(), 6);
    const dueAt = BigInt(Math.floor(Date.now() / 1000) + intent.repayInDays * 86400);
    const reqs: ActionRequest[] = [
      { kind: "supply_borrow", params: { amountUsdc6: amount, targetHealth: opts.targetHealth ?? 1.6, borrowAprPct: opts.borrowAprPct } },
      { kind: "bridge_burn", params: { amountUsdc6: amount, fromChainId: BASE_SEPOLIA.chainId, toChainId: ARC_TESTNET.chainId } },
      { kind: "bridge_relay", params: { fromChainId: BASE_SEPOLIA.chainId, toChainId: ARC_TESTNET.chainId } },
    ];
    if (intent.recipient) reqs.push({ kind: "pay", params: { to: intent.recipient as Address, amountUsdc6: amount, chainId: ARC_TESTNET.chainId, mode: "native" } });
    reqs.push({ kind: "schedule_repayment", params: { amountUsdc6: amount, dueAt, venue: BASE_SEPOLIA.comet } });
    return client.plan(reqs, { id: opts.id, intent, venueId: opts.venueId ?? "compound-v3-base-sepolia", venueExplanation: opts.venueExplanation });
  },

  /** Bridge USDC back from Arc if it is there → repay Compound → withdraw freed collateral when cleared → close the intent. */
  async repayment(client: MandateClient, intent: RepayIntent, opts: { id?: string } = {}): Promise<Plan> {
    const base = client.pub(BASE_SEPOLIA.chainId), arc = client.pub(ARC_TESTNET.chainId);
    const pos = await readCometPosition(base, client.account);
    if (pos.debtUsdc === 0n) throw new Error("no Compound debt to repay");
    const requested = parseUnits(intent.amountUsdc.toString(), 6);
    const repayAmt = requested > pos.debtUsdc ? pos.debtUsdc : requested;
    // On Arc the ERC-20 view and the native balance are the same USDC — read exactly one of them.
    const arcUsdc6 = await usdcBalance(arc, ARC_TESTNET.usdc, client.account);
    const fromArc = arcUsdc6 >= repayAmt;
    const clears = repayAmt >= pos.debtUsdc;
    const reqs: ActionRequest[] = [];
    if (fromArc) {
      reqs.push({ kind: "bridge_burn", params: { amountUsdc6: repayAmt, fromChainId: ARC_TESTNET.chainId, toChainId: BASE_SEPOLIA.chainId } });
      reqs.push({ kind: "bridge_relay", params: { fromChainId: ARC_TESTNET.chainId, toChainId: BASE_SEPOLIA.chainId } });
    }
    reqs.push({ kind: "repay", params: { amountUsdc6: repayAmt, withdrawWethWei: intent.withdrawCollateral && clears ? pos.collateralWeth : 0n } });
    if (intent.repaymentId !== undefined) reqs.push({ kind: "mark_repaid", params: { repaymentId: intent.repaymentId } });
    return client.plan(reqs, { id: opts.id ?? `repay-${Date.now().toString(36)}`, intent, venueId: "compound-v3-base-sepolia", venueExplanation: fromArc ? "Funds come back from Arc over CCTP, then repay Compound v3 on Base Sepolia." : "Repaying from USDC already on Base Sepolia." });
  },
};
