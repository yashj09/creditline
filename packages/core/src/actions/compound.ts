import { formatUnits } from "viem";
import { BASE_SEPOLIA } from "../addresses.ts";
import { buildRepay, buildSupplyAndBorrow, collateralFor, readCometPosition } from "../exec/compound.ts";
import type { ActionAdapter } from "./types.ts";

export interface SupplyBorrowParams { amountUsdc6: bigint; wethWei?: bigint; targetHealth?: number; borrowAprPct?: number }

/** Wrap ETH → supply WETH → borrow USDC on Compound v3 (Base Sepolia). Inflow step: no cap consumed. */
export const compoundSupplyBorrow: ActionAdapter<SupplyBorrowParams> = {
  kind: "supply_borrow",
  chainId: () => BASE_SEPOLIA.chainId,
  reversible: true,
  guardianRule: "policy",
  async build(p, ctx) {
    const pos = await readCometPosition(ctx.pub(BASE_SEPOLIA.chainId), ctx.account);
    const weth = p.wethWei ?? collateralFor(p.amountUsdc6, pos.wethPriceUsd, pos.liquidateCollateralFactor, p.targetHealth ?? 1.6);
    const amountUsd = Number(p.amountUsdc6) / 1e6;
    const totalDebtUsd = pos.debtUsd + amountUsd;
    const totalCollUsd = pos.collateralUsd + (Number(weth) / 1e18) * pos.wethPriceUsd;
    const hf = (pos.liquidateCollateralFactor * totalCollUsd) / totalDebtUsd;
    const liq = totalDebtUsd / (pos.liquidateCollateralFactor * (totalCollUsd / pos.wethPriceUsd));
    const apr = p.borrowAprPct ?? pos.borrowAprPct;
    return {
      title: `Borrow ${amountUsd} USDC on Compound v3`,
      description: `Wrap ${(Number(weth) / 1e18).toFixed(4)} ETH, supply as collateral, borrow ${amountUsd} USDC at ~${apr.toFixed(2)}% APR. Projected health factor ${hf.toFixed(2)}, liquidation if ETH < $${liq.toFixed(0)}.`,
      calls: buildSupplyAndBorrow(weth, p.amountUsdc6),
      maxUsdcOut: 0n,
      projection: { healthFactor: hf, liquidationPriceUsd: Number.isFinite(liq) ? liq : null, borrowAprPct: apr, wethPriceUsd: pos.wethPriceUsd, collateralWeth: weth },
    };
  },
  async afterExecute(_p, _r, ctx) {
    const pos = await readCometPosition(ctx.pub(BASE_SEPOLIA.chainId), ctx.account);
    return { healthFactor: Number.isFinite(pos.healthFactor) ? pos.healthFactor.toFixed(2) : "∞", liquidationPriceUsd: pos.liquidationPriceUsd, debtUsdc: formatUnits(pos.debtUsdc, 6) };
  },
};

export interface RepayParams { amountUsdc6: bigint; withdrawWethWei?: bigint }

/** approve → supply USDC (repays) → optionally withdraw collateral. Outflow = repaid amount (counts against caps). */
export const compoundRepay: ActionAdapter<RepayParams> = {
  kind: "repay",
  chainId: () => BASE_SEPOLIA.chainId,
  reversible: true,
  guardianRule: "policy",
  async build(p, ctx) {
    const pos = await readCometPosition(ctx.pub(BASE_SEPOLIA.chainId), ctx.account);
    const withdraw = p.withdrawWethWei ?? 0n;
    const remaining = Number(pos.debtUsdc > p.amountUsdc6 ? pos.debtUsdc - p.amountUsdc6 : 0n) / 1e6;
    const hf = remaining === 0 ? Number.POSITIVE_INFINITY : (pos.liquidateCollateralFactor * pos.collateralUsd) / remaining;
    return {
      title: `Repay ${Number(p.amountUsdc6) / 1e6} USDC on Compound v3${withdraw > 0n ? " and withdraw collateral" : ""}`,
      description: withdraw > 0n
        ? `Clears the debt and withdraws ${(Number(withdraw) / 1e18).toFixed(4)} WETH back to the account.`
        : `Reduces debt to ${remaining.toFixed(2)} USDC; projected health factor ${Number.isFinite(hf) ? hf.toFixed(2) : "∞"}.`,
      calls: buildRepay(p.amountUsdc6, withdraw),
      maxUsdcOut: p.amountUsdc6,
      projection: { healthFactor: Number.isFinite(hf) ? hf : 1e9, liquidationPriceUsd: null, borrowAprPct: pos.borrowAprPct, wethPriceUsd: pos.wethPriceUsd, collateralWeth: withdraw },
    };
  },
  afterExecute: compoundSupplyBorrow.afterExecute,
};
