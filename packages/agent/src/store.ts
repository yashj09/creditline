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

/** An approval text built by the server for (plan, step) at a given guardian nonce. Cached so GET is idempotent. */
export interface PendingApproval {
  planId: string;
  step: number;
  chainId: number;
  guardian: `0x${string}`;
  text: string;
  deadline: string; // unix seconds
  nonce: string;
  builtAt: string;
}

/** A pending approval plus the guardian's signature, verified server-side. */
export interface StoredApproval extends PendingApproval {
  signature: `0x${string}`;
  signedAt: string;
}

const approvalsPath = resolve(DATA_DIR, "approvals.json");
interface ApprovalsFile { pending: Record<string, PendingApproval>; signed: Record<string, StoredApproval> }
function readApprovals(): ApprovalsFile {
  if (!existsSync(approvalsPath)) return { pending: {}, signed: {} };
  const raw = JSON.parse(readFileSync(approvalsPath, "utf8"));
  return raw.pending && raw.signed ? (raw as ApprovalsFile) : { pending: {}, signed: {} }; // ignore pre-refactor shape
}
function writeApprovals(f: ApprovalsFile) { writeFileSync(approvalsPath, JSON.stringify(f, null, 2)); }

export const approvals = {
  key: (planId: string, step: number) => `${planId}:${step}`,
  getPending(planId: string, step: number): PendingApproval | null { return readApprovals().pending[this.key(planId, step)] ?? null; },
  putPending(a: PendingApproval) { const f = readApprovals(); f.pending[this.key(a.planId, a.step)] = a; writeApprovals(f); },
  get(planId: string, step: number): StoredApproval | null { return readApprovals().signed[this.key(planId, step)] ?? null; },
  put(a: StoredApproval) { const f = readApprovals(); f.signed[this.key(a.planId, a.step)] = a; delete f.pending[this.key(a.planId, a.step)]; writeApprovals(f); },
  delete(planId: string, step: number) { const f = readApprovals(); delete f.signed[this.key(planId, step)]; delete f.pending[this.key(planId, step)]; writeApprovals(f); },
};
