import { encodeFunctionData, type Address, type PublicClient } from "viem";
import { cometAbi, erc20Abi, wethAbi } from "../abi/protocols.ts";
import { BASE_SEPOLIA } from "../addresses.ts";
import type { Call } from "./account.ts";

/** wrap ETH → approve → supply WETH → borrow USDC, as one mandate step (net inflow, so no cap consumed). */
export function buildSupplyAndBorrow(wethAmount: bigint, usdcAmount: bigint): Call[] {
  const { weth, comet, usdc } = BASE_SEPOLIA;
  return [
    { target: weth, value: wethAmount, data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" }) },
    { target: weth, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [comet, wethAmount] }) },
    { target: comet, value: 0n, data: encodeFunctionData({ abi: cometAbi, functionName: "supply", args: [weth, wethAmount] }) },
    { target: comet, value: 0n, data: encodeFunctionData({ abi: cometAbi, functionName: "withdraw", args: [usdc, usdcAmount] }) },
  ];
}

/** approve → supply USDC (repays debt) → optionally withdraw collateral. */
export function buildRepay(usdcAmount: bigint, withdrawWeth?: bigint): Call[] {
  const { weth, comet, usdc } = BASE_SEPOLIA;
  const calls: Call[] = [
    { target: usdc, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [comet, usdcAmount] }) },
    { target: comet, value: 0n, data: encodeFunctionData({ abi: cometAbi, functionName: "supply", args: [usdc, usdcAmount] }) },
  ];
  if (withdrawWeth && withdrawWeth > 0n) {
    calls.push({ target: comet, value: 0n, data: encodeFunctionData({ abi: cometAbi, functionName: "withdraw", args: [weth, withdrawWeth] }) });
  }
  return calls;
}

export interface CometPosition {
  debtUsdc: bigint; // 6-dec
  collateralWeth: bigint; // 18-dec
  wethPriceUsd: number;
  collateralUsd: number;
  debtUsd: number;
  borrowCollateralFactor: number; // e.g. 0.775
  liquidateCollateralFactor: number; // e.g. 0.825
  /** liquidateCF * collateralUsd / debtUsd; Infinity when no debt */
  healthFactor: number;
  liquidationPriceUsd: number | null;
  borrowAprPct: number;
  supplyAprPct: number;
  utilizationPct: number;
  availableUsdc: bigint;
}

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export async function readCometPosition(client: PublicClient, account: Address): Promise<CometPosition> {
  const { weth, comet, usdc } = BASE_SEPOLIA;
  const [debt, coll, info, util, available] = await Promise.all([
    client.readContract({ address: comet, abi: cometAbi, functionName: "borrowBalanceOf", args: [account] }),
    client.readContract({ address: comet, abi: cometAbi, functionName: "collateralBalanceOf", args: [account, weth] }),
    client.readContract({ address: comet, abi: cometAbi, functionName: "getAssetInfoByAddress", args: [weth] }),
    client.readContract({ address: comet, abi: cometAbi, functionName: "getUtilization" }),
    client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [comet] }),
  ]);
  const [price, borrowRate, supplyRate] = await Promise.all([
    client.readContract({ address: comet, abi: cometAbi, functionName: "getPrice", args: [info.priceFeed] }),
    client.readContract({ address: comet, abi: cometAbi, functionName: "getBorrowRate", args: [util] }),
    client.readContract({ address: comet, abi: cometAbi, functionName: "getSupplyRate", args: [util] }),
  ]);

  const wethPriceUsd = Number(price) / 1e8;
  const collateralUsd = (Number(coll) / 1e18) * wethPriceUsd;
  const debtUsd = Number(debt) / 1e6;
  const bcf = Number(info.borrowCollateralFactor) / 1e18;
  const lcf = Number(info.liquidateCollateralFactor) / 1e18;
  const healthFactor = debtUsd === 0 ? Number.POSITIVE_INFINITY : (lcf * collateralUsd) / debtUsd;
  const liquidationPriceUsd = debtUsd === 0 || coll === 0n ? null : debtUsd / (lcf * (Number(coll) / 1e18));

  return {
    debtUsdc: debt,
    collateralWeth: coll,
    wethPriceUsd,
    collateralUsd,
    debtUsd,
    borrowCollateralFactor: bcf,
    liquidateCollateralFactor: lcf,
    healthFactor,
    liquidationPriceUsd,
    borrowAprPct: (Number(borrowRate) / 1e18) * SECONDS_PER_YEAR * 100,
    supplyAprPct: (Number(supplyRate) / 1e18) * SECONDS_PER_YEAR * 100,
    utilizationPct: (Number(util) / 1e18) * 100,
    availableUsdc: available,
  };
}

/** WETH needed (18-dec) to borrow `usdc` (6-dec) at a target health factor, given price and liquidate CF. */
export function collateralFor(usdc: bigint, wethPriceUsd: number, liquidateCF: number, targetHealth = 1.6): bigint {
  const debtUsd = Number(usdc) / 1e6;
  const wethNeeded = (debtUsd * targetHealth) / (liquidateCF * wethPriceUsd);
  return BigInt(Math.ceil(wethNeeded * 1e18));
}
