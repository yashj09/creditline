import { encodeFunctionData, type Address } from "viem";
import { MandateAccountAbi } from "../abi/MandateAccount.ts";
import { ARC_TESTNET, BASE_SEPOLIA } from "../addresses.ts";
import { encodeScheduleRepayment } from "../exec/account.ts";
import type { ActionAdapter } from "./types.ts";

export interface ScheduleParams { amountUsdc6: bigint | string; dueAt: bigint | string; venue?: Address }

/** Records a repayment intent on the Arc account. Direct agent tx (agent is authorised by the contract). */
export const scheduleRepayment: ActionAdapter<ScheduleParams> = {
  kind: "schedule_repayment",
  chainId: () => ARC_TESTNET.chainId,
  reversible: true,
  guardianRule: "never",
  async build(p, ctx) {
    const dueAt = BigInt(p.dueAt), amount = BigInt(p.amountUsdc6);
    const days = Math.round((Number(dueAt) - ctx.now()) / 86400);
    return {
      title: `Schedule repayment in ${days} days`,
      description: `Records a repayment intent of ${Number(amount) / 1e6} USDC due ${new Date(Number(dueAt) * 1000).toDateString()} on the account; the agent reminds you and can execute the reverse leg under the same mandate.`,
      calls: [],
      maxUsdcOut: 0n,
      direct: { to: ctx.account, data: encodeScheduleRepayment(dueAt, amount, p.venue ?? BASE_SEPOLIA.comet) },
    };
  },
  async isExecuted(p, ctx) {
    const due = BigInt(p.dueAt), amount = BigInt(p.amountUsdc6); // params come back from JSON as strings
    const pub = ctx.pub(ARC_TESTNET.chainId);
    const n = await pub.readContract({ address: ctx.account, abi: MandateAccountAbi, functionName: "repaymentCount" });
    for (let i = n; i > 0n; i--) {
      const [dueAt, amt] = await pub.readContract({ address: ctx.account, abi: MandateAccountAbi, functionName: "repayments", args: [i - 1n] });
      if (dueAt === due && amt === amount) return true;
      if (dueAt < due - 86400n) break;
    }
    return false;
  },
};

export interface MarkRepaidParams { repaymentId: number }

export const markRepaid: ActionAdapter<MarkRepaidParams> = {
  kind: "mark_repaid",
  chainId: () => ARC_TESTNET.chainId,
  reversible: true,
  guardianRule: "never",
  async build(p, ctx) {
    return {
      title: `Mark repayment #${p.repaymentId} done`,
      description: "Closes the repayment intent recorded on the Arc account.",
      calls: [],
      maxUsdcOut: 0n,
      direct: { to: ctx.account, data: encodeFunctionData({ abi: MandateAccountAbi, functionName: "markRepaid", args: [BigInt(p.repaymentId)] }) },
    };
  },
  async isExecuted(p, ctx) {
    const [, , , done] = await ctx.pub(ARC_TESTNET.chainId).readContract({ address: ctx.account, abi: MandateAccountAbi, functionName: "repayments", args: [BigInt(p.repaymentId)] });
    return done;
  },
};
