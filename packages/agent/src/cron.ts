import { tools } from "./tools.ts";
import { audit } from "./store.ts";

export async function runRepaymentCheck(remindDays = 2) {
  const res = (await (tools.check_repayments as any).execute({}, { toolCallId: "cron", messages: [] })) as {
    repayments: Array<{ id: number; dueAt: string; amountUsdc: string; done: boolean; daysLeft: number; overdue: boolean }>;
    currentDebtUsdc: string;
    healthFactor: string;
  };
  const due = res.repayments.filter((r) => !r.done && (r.overdue || r.daysLeft <= remindDays));
  for (const r of due) {
    audit.write({
      planId: `repayment-${r.id}`, step: 0, kind: "info",
      summary: r.overdue ? `OVERDUE: repayment #${r.id} of ${r.amountUsdc} USDC was due ${r.dueAt}` : `Reminder: repayment #${r.id} of ${r.amountUsdc} USDC due in ${r.daysLeft} day(s)`,
      data: { healthFactor: res.healthFactor, currentDebtUsdc: res.currentDebtUsdc },
    });
  }
  return { checkedAt: new Date().toISOString(), due, healthFactor: res.healthFactor, currentDebtUsdc: res.currentDebtUsdc };
}
