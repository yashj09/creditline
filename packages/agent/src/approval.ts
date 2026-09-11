import type { Hex } from "viem";
import { MandateAccountAbi, approvalText, callsHash, planIdToBytes32, verifyGuardianSignature, type Plan, type Step } from "@mandate/core";
import { getRuntime } from "./runtime.ts";
import { approvals, audit, type PendingApproval } from "./store.ts";

const TTL_SECONDS = 15 * 60;
const MIN_REMAINING_SECONDS = 60;

/**
 * Returns the approval the guardian must sign for a plan step. Idempotent: the same (plan, step, live nonce) yields the
 * same text and deadline until the deadline is near, so re-renders, refreshes, second tabs and MCP all see one request.
 * The guardian address and nonce are read from the account on the step's own chain.
 */
export async function getOrBuildApproval(plan: Plan, step: Step): Promise<PendingApproval> {
  const rt = await getRuntime();
  const pub = step.chainId === rt.arcPub.chain!.id ? rt.arcPub : rt.basePub;
  const [nonce, guardian] = await Promise.all([
    pub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "guardianNonce" }),
    rt.guardian(step.chainId),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const cached = approvals.getPending(plan.id, step.index);
  if (cached && cached.nonce === nonce.toString() && cached.guardian.toLowerCase() === guardian.toLowerCase() && Number(cached.deadline) - now > MIN_REMAINING_SECONDS) {
    return cached;
  }
  const deadline = BigInt(now + TTL_SECONDS);
  const calls = step.calls.map((c) => ({ target: c.target as Hex, value: BigInt(c.value), data: c.data as Hex }));
  const fields = { account: rt.account, chainId: step.chainId, planId: planIdToBytes32(plan.id), step: step.index, maxUsdcOut: BigInt(step.maxUsdcOut), callsHash: callsHash(calls), deadline, nonce };
  const text = approvalText(fields);
  const onchain = await pub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "approvalText", args: [fields.planId, fields.step, fields.maxUsdcOut, fields.callsHash, fields.deadline, fields.nonce] });
  if (onchain !== text) throw new Error("approval text mismatch between client mirror and contract");
  const pending: PendingApproval = { planId: plan.id, step: step.index, chainId: step.chainId, guardian, text, deadline: deadline.toString(), nonce: nonce.toString(), builtAt: new Date().toISOString() };
  approvals.putPending(pending);
  audit.write({ planId: plan.id, step: step.index, kind: "guardian-request", chainId: step.chainId, summary: `Guardian approval requested: ${step.title}`, data: { text, nonce: pending.nonce, deadline: pending.deadline } });
  return pending;
}

/**
 * Accepts a signature for the server-built approval. The client supplies nothing but the signature: text, guardian and
 * nonce come from the cached request, and the guardian is the on-chain one. Returns the stored approval.
 */
export async function acceptGuardianSignature(plan: Plan, step: Step, signature: Hex, via: "web" | "mcp") {
  const pending = approvals.getPending(plan.id, step.index) ?? (await getOrBuildApproval(plan, step));
  const rt = await getRuntime();
  const guardian = await rt.guardian(step.chainId);
  if (guardian.toLowerCase() !== pending.guardian.toLowerCase()) {
    approvals.delete(plan.id, step.index);
    throw new Error("guardian changed on-chain since the approval was built; request it again");
  }
  if (Number(pending.deadline) <= Math.floor(Date.now() / 1000)) {
    approvals.delete(plan.id, step.index);
    throw new Error("approval expired; request it again");
  }
  const ok = await verifyGuardianSignature(guardian, pending.text, signature);
  if (!ok) throw new Error("signature does not recover to the on-chain guardian");
  const stored = { ...pending, signature, signedAt: new Date().toISOString() };
  approvals.put(stored);
  step.status = "awaiting_guardian";
  audit.write({ planId: plan.id, step: step.index, kind: "guardian-approved", chainId: step.chainId, summary: `Guardian ${guardian} signed step ${step.index} (${via})` });
  return stored;
}
