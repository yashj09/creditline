import {
  decodeEventLog,
  encodeFunctionData,
  pad,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { erc20Abi, messageTransmitterV2Abi, tokenMessengerV2Abi } from "../abi/protocols.ts";
import { CCTP } from "../addresses.ts";
import type { Call } from "./account.ts";

export function addressToBytes32(a: Address): Hex {
  return pad(a, { size: 32 });
}

/** approve TokenMessengerV2 → depositForBurn(amount → destDomain, mintRecipient). Guardian-gated by policy. */
export function buildBurn(params: {
  usdc: Address;
  amount: bigint;
  destinationDomain: number;
  mintRecipient: Address;
  maxFee?: bigint; // default 1% of amount, floor 100 (Fast Transfer min is ~1.3 bps)
  fast?: boolean;
}): Call[] {
  const maxFee = params.maxFee ?? (params.amount / 100n > 100n ? params.amount / 100n : 100n);
  return [
    {
      target: params.usdc,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CCTP.tokenMessengerV2, params.amount] }),
    },
    {
      target: CCTP.tokenMessengerV2,
      value: 0n,
      data: encodeFunctionData({
        abi: tokenMessengerV2Abi,
        functionName: "depositForBurn",
        args: [
          params.amount,
          params.destinationDomain,
          addressToBytes32(params.mintRecipient),
          params.usdc,
          pad("0x", { size: 32 }), // any caller may relay
          maxFee,
          params.fast === false ? CCTP.standardFinality : CCTP.fastFinality,
        ],
      }),
    },
  ];
}

export interface Attestation {
  message: Hex;
  attestation: Hex;
  status: string;
  eventNonce?: string;
}

/** Polls Circle Iris (sandbox) until the burn is attested. Fast Transfer from Base Sepolia takes ~8–20s. */
export async function waitForAttestation(
  sourceDomain: number,
  burnTxHash: Hex,
  opts: { timeoutMs?: number; intervalMs?: number; baseUrl?: string } = {},
): Promise<Attestation> {
  const base = opts.baseUrl ?? CCTP.irisSandbox;
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  const url = `${base}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
  while (Date.now() < deadline) {
    const res = await fetch(url);
    if (res.ok) {
      const body = (await res.json()) as { messages?: Array<{ message: Hex; attestation: Hex; status: string; eventNonce?: string }> };
      const m = body.messages?.[0];
      if (m && m.status === "complete" && m.attestation && (m.attestation as string) !== "PENDING") {
        return { message: m.message, attestation: m.attestation, status: m.status, eventNonce: m.eventNonce };
      }
    } else if (res.status !== 404) {
      throw new Error(`Iris ${res.status}: ${await res.text()}`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 3_000));
  }
  throw new Error("CCTP attestation timed out");
}

/** Destination-side mint. Permissionless; the agent wallet can call it directly (not via the account). */
export function encodeReceiveMessage(a: Attestation): Hex {
  return encodeFunctionData({
    abi: messageTransmitterV2Abi,
    functionName: "receiveMessage",
    args: [a.message, a.attestation],
  });
}

/** Extracts the DepositForBurn event (sanity check that the burn happened) from a receipt. */
export function findBurnEvent(receipt: TransactionReceipt) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CCTP.tokenMessengerV2.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: tokenMessengerV2Abi, data: log.data, topics: log.topics });
      if (ev.eventName === "DepositForBurn") return ev.args;
    } catch {
      /* not ours */
    }
  }
  return null;
}

export async function usdcBalance(client: PublicClient, usdc: Address, who: Address): Promise<bigint> {
  return client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}
