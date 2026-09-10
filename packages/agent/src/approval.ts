import type { Hex } from "viem";
import { MandateAccountAbi, approvalText, callsHash, planIdToBytes32, verifyGuardianSignature, type Plan, type Step } from "@mandate/core";
import { getRuntime } from "./runtime.ts";

/** Builds the exact EIP-191 text for a plan step, reading the live guardian nonce from the right chain. */
export async function buildApproval(plan: Plan, step: Step, ttlSeconds = 15 * 60) {
  const rt = await getRuntime();
  const pub = step.chainId === rt.basePub.chain!.id ? rt.basePub : rt.arcPub;
  const nonce = await pub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "guardianNonce" });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + ttlSeconds);
  const calls = step.calls.map((c) => ({ target: c.target as Hex, value: BigInt(c.value), data: c.data as Hex }));
  const fields = {
    account: rt.account,
    chainId: step.chainId,
    planId: planIdToBytes32(plan.id),
    step: step.index,
    maxUsdcOut: BigInt(step.maxUsdcOut),
    callsHash: callsHash(calls),
    deadline,
    nonce,
  };
  const text = approvalText(fields);
  // belt and braces: the contract must agree on the bytes
  const onchain = await pub.readContract({
    address: rt.account,
    abi: MandateAccountAbi,
    functionName: "approvalText",
    args: [fields.planId, fields.step, fields.maxUsdcOut, fields.callsHash, fields.deadline, fields.nonce],
  });
  if (onchain !== text) throw new Error("approval text mismatch between client mirror and contract");
  return { text, deadline: deadline.toString(), nonce: nonce.toString(), guardian: await rt.guardian(), chainId: step.chainId };
}

export async function verifyApproval(guardian: Hex, text: string, signature: Hex) {
  return verifyGuardianSignature(guardian, text, signature);
}
