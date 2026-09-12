import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { GuardianSigner } from "./types.ts";

/** Dev/test guardian backed by a raw key. Never use for real funds — the point of Mandate is a hardware guardian. */
export function localGuardian(privateKey: Hex): GuardianSigner {
  const acct = privateKeyToAccount(privateKey);
  return {
    kind: "local",
    address: async () => acct.address,
    signMessage: async (text, onStatus) => { onStatus?.("local guardian: signing"); return acct.signMessage({ message: text }); },
  };
}
