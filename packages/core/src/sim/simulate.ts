import { decodeErrorResult, type Address, type Hex, type PublicClient } from "viem";
import { MandateAccountAbi } from "../abi/MandateAccount.ts";
import type { Step } from "../plan/schema.ts";

export interface StepSimulation {
  ok: boolean;
  revertReason?: string;
  notes: string[];
  /** true when only static checks ran because earlier steps have not executed yet */
  deferred?: boolean;
}

function decodeRevert(data: Hex | undefined): string | undefined {
  if (!data || data === "0x") return undefined;
  try {
    const d = decodeErrorResult({ abi: MandateAccountAbi, data });
    return `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
  } catch {
    return data.slice(0, 10);
  }
}

function selectorOf(data: Hex): Hex {
  return (data.length >= 10 ? data.slice(0, 10) : "0x00000000") as Hex;
}

/**
 * Dry-runs a step.
 *  - Static check (always): every call's (target, selector) must be allow-listed; guardian flag must match.
 *  - Dynamic check (only when all earlier steps are done, so the chain state is the one this step will see):
 *      agent-only steps → simulate `execute` from the agent (exercises policy + caps for real);
 *      guardian steps  → simulate the same calls as one batch via `ownerExecute` from the owner (no signature
 *      needed for eth_call; exercises approvals/burn limits in sequence).
 */
export async function simulateStep(
  client: PublicClient,
  step: Step,
  ctx: { account: Address; agent: Address; owner: Address; planId: Hex; priorStepsDone: boolean },
): Promise<StepSimulation> {
  const notes: string[] = [];
  if (step.calls.length === 0) return { ok: true, deferred: true, notes: ["direct agent transaction (relay / repayment record); verified against the chain at execution time"] };
  const calls = step.calls.map((c) => ({ target: c.target as Address, value: BigInt(c.value), data: c.data as Hex }));

  // static: policy
  for (const c of calls) {
    const p = await client.readContract({ address: ctx.account, abi: MandateAccountAbi, functionName: "policyFor", args: [c.target, selectorOf(c.data)] });
    if (!p.allowed) return { ok: false, revertReason: `CallNotAllowed(${c.target}, ${selectorOf(c.data)})`, notes };
    if (p.requiresGuardian && !step.requiresGuardian) return { ok: false, revertReason: `policy requires guardian for ${selectorOf(c.data)} but step is marked autonomous`, notes };
  }
  notes.push("policy allow-list ok");

  if (!ctx.priorStepsDone) {
    notes.push("dynamic simulation deferred until earlier steps execute");
    return { ok: true, notes, deferred: true };
  }

  try {
    if (!step.requiresGuardian) {
      await client.simulateContract({ address: ctx.account, abi: MandateAccountAbi, functionName: "execute", args: [calls, ctx.planId, step.index], account: ctx.agent });
      notes.push("execute() passes policy and cap checks");
    } else {
      await client.simulateContract({ address: ctx.account, abi: MandateAccountAbi, functionName: "ownerExecute", args: [calls], account: ctx.owner });
      notes.push("calls succeed as a batch; guardian signature required before execution");
    }
    return { ok: true, notes };
  } catch (e: any) {
    const data: Hex | undefined = e?.cause?.data ?? e?.data ?? e?.cause?.cause?.data;
    return { ok: false, revertReason: decodeRevert(typeof data === "string" ? data : undefined) ?? e?.shortMessage ?? String(e), notes };
  }
}
