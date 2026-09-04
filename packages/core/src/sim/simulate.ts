import { decodeErrorResult, type Address, type Hex, type PublicClient } from "viem";
import { MandateAccountAbi } from "../abi/MandateAccount.ts";
import type { Step } from "../plan/schema.ts";

export interface StepSimulation {
  ok: boolean;
  revertReason?: string;
  notes: string[];
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

/**
 * Dry-runs a step. Inside-mandate steps are simulated as the agent calling `execute` (so policy and cap checks are
 * exercised for real). Guardian steps cannot be simulated through the account without a signature, so each inner
 * call is simulated with `from = account`, which exercises the protocol logic (approvals, CCTP burn limits, …).
 */
export async function simulateStep(
  client: PublicClient,
  step: Step,
  ctx: { account: Address; agent: Address; planId: Hex },
): Promise<StepSimulation> {
  const notes: string[] = [];
  if (step.calls.length === 0) return { ok: true, notes: ["direct agent transaction; simulated at execution time"] };
  const calls = step.calls.map((c) => ({ target: c.target as Address, value: BigInt(c.value), data: c.data as Hex }));

  if (!step.requiresGuardian) {
    try {
      await client.simulateContract({
        address: ctx.account,
        abi: MandateAccountAbi,
        functionName: "execute",
        args: [calls, ctx.planId, step.index],
        account: ctx.agent,
      });
      notes.push("execute() passes policy and cap checks");
      return { ok: true, notes };
    } catch (e: any) {
      const data: Hex | undefined = e?.cause?.data ?? e?.data;
      return { ok: false, revertReason: decodeRevert(data) ?? e?.shortMessage ?? String(e), notes };
    }
  }

  for (const [i, c] of calls.entries()) {
    try {
      await client.call({ account: ctx.account, to: c.target, data: c.data, value: c.value });
      notes.push(`call ${i + 1}/${calls.length} to ${c.target.slice(0, 10)}… ok`);
    } catch (e: any) {
      return { ok: false, revertReason: `call ${i + 1}: ${e?.shortMessage ?? String(e)}`, notes };
    }
  }
  notes.push("guardian signature required before execution");
  return { ok: true, notes };
}
