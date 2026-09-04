import { encodeFunctionData, type Address } from "viem";
import { erc20Abi } from "../abi/protocols.ts";
import type { Call } from "./account.ts";

/**
 * Pay a recipient in USDC. On Arc, USDC is the native token so a plain value transfer (18-dec) is the
 * cheapest path; the ERC-20 view at 0x3600… also works. Both are guardian-gated by the default policy.
 */
export function buildPay(params: { to: Address; amountUsdc6: bigint; mode: "native" | "erc20"; usdc?: Address }): Call[] {
  if (params.mode === "native") {
    return [{ target: params.to, value: params.amountUsdc6 * 1_000_000_000_000n, data: "0x" }];
  }
  if (!params.usdc) throw new Error("usdc address required for erc20 mode");
  return [
    {
      target: params.usdc,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [params.to, params.amountUsdc6] }),
    },
  ];
}
