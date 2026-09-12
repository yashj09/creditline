import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plan } from "../plan/schema.ts";
import { AuditLog } from "../audit/log.ts";
import type { PendingApproval, Store, StoredApproval } from "./types.ts";

interface ApprovalsFile { pending: Record<string, PendingApproval>; signed: Record<string, StoredApproval> }

/** JSON files under `dir`: plans/<id>.json, approvals.json, audit.jsonl. Single machine, no locking. */
export function fileStore(dir: string): Store {
  mkdirSync(resolve(dir, "plans"), { recursive: true });
  const approvalsPath = resolve(dir, "approvals.json");
  const auditLog = new AuditLog(resolve(dir, "audit.jsonl"));
  const key = (p: string, s: number) => `${p}:${s}`;
  const readA = (): ApprovalsFile => {
    if (!existsSync(approvalsPath)) return { pending: {}, signed: {} };
    const raw = JSON.parse(readFileSync(approvalsPath, "utf8"));
    return raw.pending && raw.signed ? raw : { pending: {}, signed: {} };
  };
  const writeA = (f: ApprovalsFile) => writeFileSync(approvalsPath, JSON.stringify(f, null, 2));
  return {
    plans: {
      async get(id) { const p = resolve(dir, "plans", `${id}.json`); return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Plan) : null; },
      async save(plan) { writeFileSync(resolve(dir, "plans", `${plan.id}.json`), JSON.stringify(plan, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)); },
      async list() {
        return readdirSync(resolve(dir, "plans")).filter((f) => f.endsWith(".json"))
          .map((f) => JSON.parse(readFileSync(resolve(dir, "plans", f), "utf8")) as Plan)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      },
    },
    approvals: {
      async getPending(p, s) { return readA().pending[key(p, s)] ?? null; },
      async putPending(a) { const f = readA(); f.pending[key(a.planId, a.step)] = a; writeA(f); },
      async get(p, s) { return readA().signed[key(p, s)] ?? null; },
      async put(a) { const f = readA(); f.signed[key(a.planId, a.step)] = a; delete f.pending[key(a.planId, a.step)]; writeA(f); },
      async delete(p, s) { const f = readA(); delete f.signed[key(p, s)]; delete f.pending[key(p, s)]; writeA(f); },
    },
    audit: {
      async write(e) { return auditLog.write(e); },
      async read(planId) { return auditLog.read(planId); },
    },
  };
}
