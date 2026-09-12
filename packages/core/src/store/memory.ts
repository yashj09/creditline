import type { Plan } from "../plan/schema.ts";
import type { AuditEntry } from "../audit/log.ts";
import type { PendingApproval, Store, StoredApproval } from "./types.ts";

/** In-process store. Default when none is given; fine for scripts, tests and single-request agents. */
export function memoryStore(): Store {
  const plans = new Map<string, Plan>();
  const pending = new Map<string, PendingApproval>();
  const signed = new Map<string, StoredApproval>();
  const audit: AuditEntry[] = [];
  const key = (p: string, s: number) => `${p}:${s}`;
  return {
    plans: {
      async get(id) { return plans.get(id) ?? null; },
      async save(plan) { plans.set(plan.id, structuredClone(plan)); },
      async list() { return [...plans.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },
    },
    approvals: {
      async getPending(p, s) { return pending.get(key(p, s)) ?? null; },
      async putPending(a) { pending.set(key(a.planId, a.step), a); },
      async get(p, s) { return signed.get(key(p, s)) ?? null; },
      async put(a) { signed.set(key(a.planId, a.step), a); pending.delete(key(a.planId, a.step)); },
      async delete(p, s) { signed.delete(key(p, s)); pending.delete(key(p, s)); },
    },
    audit: {
      async write(e) { const full = { ts: new Date().toISOString(), ...e }; audit.push(full); return full; },
      async read(planId) { return audit.filter((e) => !planId || e.planId === planId); },
    },
  };
}
