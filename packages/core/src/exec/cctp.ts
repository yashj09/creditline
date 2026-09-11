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

/** CCTP v2 message layout: version(4) | sourceDomain(4) | destinationDomain(4) | nonce(32) | … */
export function messageNonce(message: Hex): Hex {
  return `0x${message.slice(2 + 24, 2 + 24 + 64)}` as Hex;
}

/** True once the destination MessageTransmitter has consumed this message (i.e. the mint already happened). */
export async function isMessageReceived(client: PublicClient, message: Hex): Promise<boolean> {
  const used = await client.readContract({ address: CCTP.messageTransmitterV2, abi: messageTransmitterV2Abi, functionName: "usedNonces", args: [messageNonce(message)] });
  return used !== 0n;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ARC_NATIVE_LOG_EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe";

/**
 * USDC credited to `account` in this receipt, in 6-dec units, read from Transfer logs rather than from a balance
 * re-read (public RPCs lag). On Arc the native-USDC emitter logs 18-dec values; the ERC-20 view logs 6-dec.
 */
export function usdcCreditedInReceipt(receipt: TransactionReceipt, account: Address, usdc: Address): bigint {
  // On Arc a single native-USDC credit is logged twice: by the ERC-20 view (6-dec) and by the native emitter (18-dec).
  // Count the ERC-20 view when present and fall back to the native emitter only when it is not.
  let erc20 = 0n;
  let native = 0n;
  const acct = account.toLowerCase().replace("0x", "").padStart(64, "0");
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    if ((log.topics[2] as string).toLowerCase().replace("0x", "") !== acct) continue;
    const value = BigInt(log.data);
    const emitter = log.address.toLowerCase();
    if (emitter === usdc.toLowerCase()) erc20 += value;
    else if (emitter === ARC_NATIVE_LOG_EMITTER) native += value / 1_000_000_000_000n;
  }
  return erc20 > 0n ? erc20 : native;
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
