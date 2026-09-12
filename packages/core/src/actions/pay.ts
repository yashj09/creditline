import type { Address } from "viem";
import { ARC_TESTNET, usdcFor } from "../addresses.ts";
import { buildPay } from "../exec/pay.ts";
import type { ActionAdapter } from "./types.ts";

export interface PayParams { to: Address; amountUsdc6: bigint; chainId?: number; mode?: "native" | "erc20" }

/** Pay a third party in USDC (native on Arc). Value leaves the account → guardian (by policy). */
export const pay: ActionAdapter<PayParams> = {
  kind: "pay",
  chainId: (p) => p.chainId ?? ARC_TESTNET.chainId,
  reversible: false,
  guardianRule: "policy",
  async build(p) {
    const amt = Number(p.amountUsdc6) / 1e6;
    const chain = p.chainId ?? ARC_TESTNET.chainId;
    const mode = p.mode ?? (chain === ARC_TESTNET.chainId ? "native" : "erc20");
    return {
      title: `Pay ${amt} USDC to ${p.to.slice(0, 6)}…${p.to.slice(-4)} on ${chain === ARC_TESTNET.chainId ? "Arc" : "Base"}`,
      description: mode === "native" ? "Native USDC transfer on Arc. Value leaves the account → guardian approval." : "ERC-20 USDC transfer. Value leaves the account → guardian approval.",
      calls: buildPay({ to: p.to, amountUsdc6: p.amountUsdc6, mode, usdc: mode === "erc20" ? usdcFor(chain) : undefined }),
      maxUsdcOut: p.amountUsdc6,
    };
  },
};
