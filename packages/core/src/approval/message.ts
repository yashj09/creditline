import { type Address, type Hex, verifyMessage } from "viem";

export interface ApprovalFields {
  account: Address;
  chainId: number;
  planId: Hex; // bytes32
  step: number;
  maxUsdcOut: bigint; // 6-dec
  callsHash: Hex; // bytes32
  deadline: bigint; // unix seconds
  nonce: bigint;
}

/** Formats a 6-dec USDC amount exactly like `MandateAccount._formatUsdc`. */
export function formatUsdc6(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = (amount % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

/**
 * Byte-for-byte reproduction of `MandateAccount.approvalText`. This is the string the Ledger clear-signs
 * (EIP-191 personal_sign) and the contract rebuilds to recover the guardian.
 */
export function approvalText(f: ApprovalFields): string {
  return [
    "Mandate approval",
    `Account: ${f.account.toLowerCase()}`,
    `Chain: ${f.chainId}`,
    `Plan: ${f.planId.toLowerCase()}`,
    `Step: ${f.step}`,
    `Max USDC out: ${formatUsdc6(f.maxUsdcOut)}`,
    `Calls: ${f.callsHash.toLowerCase()}`,
    `Deadline: ${f.deadline}`,
    `Nonce: ${f.nonce}`,
  ].join("\n");
}

export async function verifyGuardianSignature(guardian: Address, text: string, signature: Hex): Promise<boolean> {
  return verifyMessage({ address: guardian, message: text, signature });
}
