import type { Address, Hex } from "viem";

/**
 * Whoever co-signs irreversible or over-cap steps. Signs the canonical approval text with EIP-191 personal_sign.
 * Adapters: `localGuardian` (dev/test), `ledgerNodeGuardian` (USB, Node), `ledgerWebGuardian` (WebHID, browser —
 * import from `@yashjain99/mandate-sdk/ledger-web`). Any wallet that can personal_sign works.
 */
export interface GuardianSigner {
  readonly kind: string;
  address(): Promise<Address>;
  signMessage(text: string, onStatus?: (s: string) => void): Promise<Hex>;
}
