import { parseUnits, type Address, type PublicClient } from "viem";
import { ARC_TESTNET, BASE_SEPOLIA, CCTP } from "../addresses.ts";
import { chains } from "../chains.ts";
import type { Call } from "../exec/account.ts";
import { encodeReceiveMessage } from "../exec/cctp.ts";
import { buildBurn } from "../exec/cctp.ts";
import { buildSupplyAndBorrow, collateralFor, readCometPosition, type CometPosition } from "../exec/compound.ts";
import { buildPay } from "../exec/pay.ts";
import type { Ranked } from "../markets/venues.ts";
import type { Intent, Plan, Step } from "./schema.ts";

const ser = (calls: Call[]) => calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data }));

/**
 * Deterministic planner. The LLM decides *what* the user wants (Intent) and explains; this function decides *how*,
 * so the executed calls never come from free-form model output. Reversibility and guardian requirements are
 * derived from the action type and the on-chain policy, not guessed.
 */
export async function buildLiquidityPlan(params: {
  id: string;
  intent: Intent;
  account: Address;
  ranked: Ranked;
  baseSepolia: PublicClient;
  targetHealth?: number;
  perTxCapUsdc6: bigint;
}): Promise<Plan> {
  const { intent, account, ranked } = params;
  const amount = parseUnits(intent.amountUsdc.toString(), 6);
  const venue = ranked.recommended;
  if (!venue?.executable) throw new Error("no executable venue for this amount");
  if (venue.executable.chainId !== BASE_SEPOLIA.chainId) throw new Error(`venue ${venue.venueId} executor not implemented yet (Aave Arbitrum Sepolia is a stretch goal)`);

  const pos: CometPosition = await readCometPosition(params.baseSepolia, account);
  const weth = collateralFor(amount, pos.wethPriceUsd, pos.liquidateCollateralFactor, params.targetHealth ?? 1.6);
  const totalDebtUsd = pos.debtUsd + intent.amountUsdc;
  const totalCollUsd = pos.collateralUsd + (Number(weth) / 1e18) * pos.wethPriceUsd;
  const hf = (pos.liquidateCollateralFactor * totalCollUsd) / totalDebtUsd;
  const liq = totalDebtUsd / (pos.liquidateCollateralFactor * (totalCollUsd / pos.wethPriceUsd));

  const steps: Step[] = [];
  const s1 = buildSupplyAndBorrow(weth, amount);
  steps.push({
    index: 1, kind: "supply_borrow", chainId: BASE_SEPOLIA.chainId,
    title: `Borrow ${intent.amountUsdc} USDC on Compound v3`,
    description: `Wrap ${(Number(weth) / 1e18).toFixed(4)} ETH, supply as collateral, borrow ${intent.amountUsdc} USDC at ~${venue.borrowAprPct.toFixed(2)}% APR. Projected health factor ${hf.toFixed(2)}, liquidation if ETH < $${liq.toFixed(0)}.`,
    reversible: true, requiresGuardian: false, maxUsdcOut: "0", calls: ser(s1), status: "pending",
  });

  const s2 = buildBurn({ usdc: BASE_SEPOLIA.usdc, amount, destinationDomain: ARC_TESTNET.domain, mintRecipient: account });
  steps.push({
    index: 2, kind: "bridge_burn", chainId: BASE_SEPOLIA.chainId,
    title: `Bridge ${intent.amountUsdc} USDC to Arc (CCTP v2 Fast Transfer)`,
    description: "Burns USDC on Base Sepolia for a native mint on Arc (~8s). Irreversible once burned → guardian approval.",
    reversible: false, requiresGuardian: true, maxUsdcOut: amount.toString(), calls: ser(s2), status: "pending",
  });

  steps.push({
    index: 3, kind: "bridge_relay", chainId: ARC_TESTNET.chainId,
    title: "Mint on Arc",
    description: "Relay Circle's attestation to Arc's MessageTransmitter (permissionless; the agent wallet pays gas in USDC).",
    reversible: true, requiresGuardian: false, maxUsdcOut: "0", calls: [], status: "pending",
    direct: { to: CCTP.messageTransmitterV2, data: "0x" }, // filled at runtime with encodeReceiveMessage(attestation)
  });

  if (intent.recipient) {
    const s4 = buildPay({ to: intent.recipient as Address, amountUsdc6: amount, mode: "native" });
    steps.push({
      index: 4, kind: "pay", chainId: ARC_TESTNET.chainId,
      title: `Pay ${intent.amountUsdc} USDC to ${intent.recipient.slice(0, 6)}…${intent.recipient.slice(-4)} on Arc`,
      description: "Native USDC transfer on Arc. Value leaves the account → guardian approval.",
      reversible: false, requiresGuardian: true, maxUsdcOut: amount.toString(), calls: ser(s4), status: "pending",
    });
  }

  const dueAt = Math.floor(Date.now() / 1000) + intent.repayInDays * 86400;
  steps.push({
    index: steps.length + 1, kind: "schedule_repayment", chainId: ARC_TESTNET.chainId,
    title: `Schedule repayment in ${intent.repayInDays} days`,
    description: `Records a repayment intent of ${intent.amountUsdc} USDC due ${new Date(dueAt * 1000).toDateString()} on the account; the agent reminds you and can execute the reverse leg under the same mandate.`,
    reversible: true, requiresGuardian: false, maxUsdcOut: "0",
    calls: [], status: "pending",
    direct: { to: account, data: "0x" }, // encodeScheduleRepayment at runtime
  });

  return {
    id: params.id,
    createdAt: new Date().toISOString(),
    intent,
    venueId: venue.venueId,
    venueExplanation: ranked.explanation,
    account,
    collateralWeth: weth.toString(),
    projected: { healthFactor: hf, liquidationPriceUsd: Number.isFinite(liq) ? liq : null, borrowAprPct: venue.borrowAprPct, wethPriceUsd: pos.wethPriceUsd },
    steps,
  };
}

export { encodeReceiveMessage, chains };
