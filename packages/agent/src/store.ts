import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Plan } from "@mandate/core";
import { AuditLog } from "@mandate/core";

/** Workspace-root `.data/` — shared with the core e2e script so the Activity page shows both. */
// Every surface (apps/web, apps/mcp, packages/core scripts) runs from its own package dir, two levels below the root.
export const DATA_DIR = process.env.MANDATE_DATA_DIR ?? resolve(process.cwd(), "../../.data");
mkdirSync(resolve(DATA_DIR, "plans"), { recursive: true });

export const audit = new AuditLog(resolve(DATA_DIR, "audit.jsonl"));

export const plans = {
  get(id: string): Plan | null {
    const p = resolve(DATA_DIR, "plans", `${id}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Plan) : null;
  },
  save(plan: Plan) {
    writeFileSync(resolve(DATA_DIR, "plans", `${plan.id}.json`), JSON.stringify(plan, null, 2));
  },
  list(): Plan[] {
    return readdirSync(resolve(DATA_DIR, "plans"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(resolve(DATA_DIR, "plans", f), "utf8")) as Plan)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
};

export interface StoredApproval {
  planId: string;
  step: number;
  text: string;
  signature: `0x${string}`;
  deadline: string;
  nonce: string;
  guardian: `0x${string}`;
  signedAt: string;
}

const approvalsPath = resolve(DATA_DIR, "approvals.json");
function readApprovals(): Record<string, StoredApproval> {
  return existsSync(approvalsPath) ? (JSON.parse(readFileSync(approvalsPath, "utf8")) as Record<string, StoredApproval>) : {};
}
export const approvals = {
  key: (planId: string, step: number) => `${planId}:${step}`,
  get(planId: string, step: number): StoredApproval | null {
    return readApprovals()[this.key(planId, step)] ?? null;
  },
  put(a: StoredApproval) {
    const all = readApprovals();
    all[this.key(a.planId, a.step)] = a;
    writeFileSync(approvalsPath, JSON.stringify(all, null, 2));
  },
  delete(planId: string, step: number) {
    const all = readApprovals();
    delete all[this.key(planId, step)];
    writeFileSync(approvalsPath, JSON.stringify(all, null, 2));
  },
};
