import type { Address } from "viem";
import { ARC_TESTNET, BASE_SEPOLIA, CCTP } from "../addresses.ts";
import { buildBurn, encodeReceiveMessage, isMessageReceived, usdcCreditedInReceipt } from "../exec/cctp.ts";
import type { ActionAdapter } from "./types.ts";

const CHAIN_INFO: Record<number, { name: string; domain: number; usdc: Address }> = {
  [BASE_SEPOLIA.chainId]: { name: "Base", domain: BASE_SEPOLIA.domain, usdc: BASE_SEPOLIA.usdc },
  [ARC_TESTNET.chainId]: { name: "Arc", domain: ARC_TESTNET.domain, usdc: ARC_TESTNET.usdc },
};
export const cctpChainInfo = (chainId: number) => {
  const c = CHAIN_INFO[chainId];
  if (!c) throw new Error(`CCTP: unsupported chain ${chainId}`);
  return c;
};

export interface BurnParams { amountUsdc6: bigint; fromChainId: number; toChainId: number }

/** approve + depositForBurn towards the same account on the destination chain. Irreversible → guardian (by policy). */
export const cctpBurn: ActionAdapter<BurnParams> = {
  kind: "bridge_burn",
  chainId: (p) => p.fromChainId,
  reversible: false,
  guardianRule: "policy",
  async build(p, ctx) {
    const from = cctpChainInfo(p.fromChainId);
    const to = cctpChainInfo(p.toChainId);
    const amt = Number(p.amountUsdc6) / 1e6;
    const fast = p.fromChainId !== ARC_TESTNET.chainId;
    return {
      title: p.toChainId === ARC_TESTNET.chainId ? `Bridge ${amt} USDC to Arc (CCTP v2 Fast Transfer)` : `Bridge ${amt} USDC back to ${to.name} (CCTP v2)`,
      description: fast
        ? `Burns USDC on ${from.name} for a native mint on ${to.name} (~8s). Irreversible once burned → guardian approval.`
        : `Burns USDC on ${from.name} for a mint on ${to.name} (~1 block on Arc, then attestation). Irreversible → guardian approval.`,
      calls: buildBurn({ usdc: from.usdc, amount: p.amountUsdc6, destinationDomain: to.domain, mintRecipient: ctx.account, fast }),
      maxUsdcOut: p.amountUsdc6,
    };
  },
};

export interface RelayParams { fromChainId: number; toChainId: number }

/** receiveMessage on the destination transmitter — permissionless, sent by the agent wallet directly. */
export const cctpRelay: ActionAdapter<RelayParams> = {
  kind: "bridge_relay",
  chainId: (p) => p.toChainId,
  reversible: true,
  guardianRule: "never",
  async build(p) {
    const to = cctpChainInfo(p.toChainId);
    return {
      title: `Mint on ${to.name}${p.toChainId === BASE_SEPOLIA.chainId ? " Sepolia" : ""}`,
      description: `Relay Circle's attestation to ${to.name}'s MessageTransmitter (permissionless; the agent wallet pays gas).`,
      calls: [],
      maxUsdcOut: 0n,
      direct: { to: CCTP.messageTransmitterV2, data: "0x" },
    };
  },
  async isExecuted(_p, ctx) {
    return ctx.attestation ? isMessageReceived(ctx.pub(ctx.step.chainId), ctx.attestation.message) : false;
  },
  async resolveDirect(_p, ctx) {
    if (!ctx.attestation) throw new Error("relay: attestation missing");
    return { to: CCTP.messageTransmitterV2, data: encodeReceiveMessage(ctx.attestation) };
  },
  async afterExecute(p, receipt, ctx) {
    const minted = usdcCreditedInReceipt(receipt, ctx.account, cctpChainInfo(p.toChainId).usdc);
    return { mintedUsdc: (Number(minted) / 1e6).toString() };
  },
};
