import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
  ts: string;
  planId: string;
  step: number;
  kind: "plan" | "simulate" | "execute" | "guardian-request" | "guardian-approved" | "error" | "info";
  chainId?: number;
  txHash?: string;
  explorer?: string;
  summary: string;
  reasoning?: string;
  data?: Record<string, unknown>;
}

/** Append-only JSONL audit log. Swapped for SQLite when the web console lands; the shape stays. */
export class AuditLog {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  write(entry: Omit<AuditEntry, "ts">): AuditEntry {
    const full: AuditEntry = { ts: new Date().toISOString(), ...entry };
    appendFileSync(this.path, JSON.stringify(full, (_, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
    return full;
  }

  read(planId?: string): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEntry)
      .filter((e) => !planId || e.planId === planId);
  }
}
