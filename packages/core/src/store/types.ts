import type { Plan } from "../plan/schema.ts";
import type { AuditEntry } from "../audit/log.ts";

/** An approval text built for (plan, step) at a given guardian nonce. Cached so requests are idempotent. */
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

/** A pending approval plus the guardian's verified signature. */
export interface StoredApproval extends PendingApproval {
  signature: `0x${string}`;
  signedAt: string;
}

/**
 * Persistence the SDK needs. Implement this to back Mandate with Postgres, Redis, KV… The SDK ships
 * `memoryStore()` (default) and `fileStore(dir)` (single-machine JSON files, used by the web console and MCP server).
 */
export interface Store {
  plans: {
    get(id: string): Promise<Plan | null>;
    save(plan: Plan): Promise<void>;
    list(): Promise<Plan[]>;
  };
  approvals: {
    getPending(planId: string, step: number): Promise<PendingApproval | null>;
    putPending(a: PendingApproval): Promise<void>;
    get(planId: string, step: number): Promise<StoredApproval | null>;
    put(a: StoredApproval): Promise<void>;
    delete(planId: string, step: number): Promise<void>;
  };
  audit: {
    write(entry: Omit<AuditEntry, "ts">): Promise<AuditEntry>;
    read(planId?: string): Promise<AuditEntry[]>;
  };
}
