import { decodeErrorResult, type Hex } from "viem";
import { MandateAccountAbi } from "./abi/MandateAccount.ts";

export class MandateError extends Error {
  constructor(message: string, readonly code: string, readonly details?: Record<string, unknown>) { super(message); this.name = "MandateError"; }
}

/** Turns revert data (or an error carrying it) into a MandateError with the contract's custom error name as `code`. */
export function decodeMandateError(e: unknown): MandateError | null {
  const data = extractRevertData(e);
  if (!data || data === "0x") return null;
  try {
    const d = decodeErrorResult({ abi: MandateAccountAbi, data });
    const args = (d.args ?? []).map(String);
    return new MandateError(`${d.errorName}(${args.join(", ")})`, d.errorName, { args });
  } catch {
    return null;
  }
}

export function extractRevertData(e: any): Hex | undefined {
  let cur = e;
  for (let i = 0; i < 6 && cur; i++) {
    if (typeof cur.data === "string" && cur.data.startsWith("0x")) return cur.data as Hex;
    if (typeof cur.raw === "string" && cur.raw.startsWith("0x")) return cur.raw as Hex;
    cur = cur.cause;
  }
  return undefined;
}

/** Human-readable reason for any thrown error: decoded custom error when available, else the short message. */
export function describeError(e: unknown): string {
  return decodeMandateError(e)?.message ?? (e as any)?.shortMessage ?? (e as Error)?.message ?? String(e);
}
