import type { MandateClient } from "@yashjain99/mandate-sdk";

/** Repayment reminders: writes audit entries for intents due within `remindDays` or overdue. Never moves money. */
export async function runRepaymentCheck(client: MandateClient, remindDays = 2) {
  const res = await client.repayments();
  const due = res.repayments.filter((r) => !r.done && (r.overdue || r.daysLeft <= remindDays));
  for (const r of due) {
    await client.store.audit.write({ planId: `repayment-${r.id}`, step: 0, kind: "info", summary: r.overdue ? `OVERDUE: repayment #${r.id} of ${r.amountUsdc} USDC was due ${r.dueAt}` : `Reminder: repayment #${r.id} of ${r.amountUsdc} USDC due in ${r.daysLeft} day(s)`, data: { healthFactor: res.healthFactor, currentDebtUsdc: res.currentDebtUsdc } });
  }
  return { checkedAt: new Date().toISOString(), due: due.map(({ amountUsdc6, ...x }) => x), healthFactor: res.healthFactor, currentDebtUsdc: res.currentDebtUsdc };
}
