"use client";
import type { GuardianSigner } from "@yashjain99/mandate-sdk/ledger-web";

/** Ledger over WebHID by default; `NEXT_PUBLIC_DEV_GUARDIAN_KEY` swaps in a local dev signer (must be the on-chain guardian). */
export type { GuardianSigner };
export async function getGuardianSigner(): Promise<GuardianSigner> {
  const devKey = process.env.NEXT_PUBLIC_DEV_GUARDIAN_KEY as `0x${string}` | undefined;
  if (devKey) {
    const { privateKeyToAccount } = await import("viem/accounts");
    const acct = privateKeyToAccount(devKey);
    return { kind: "dev", address: async () => acct.address, signMessage: async (text, onStatus) => { onStatus?.("dev signer (no device) — signing locally"); return acct.signMessage({ message: text }); } };
  }
  const { ledgerWebGuardian } = await import("@yashjain99/mandate-sdk/ledger-web");
  return ledgerWebGuardian();
}
