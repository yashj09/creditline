import type { Address, Hex } from "viem";

/**
 * The agent's signing wallet. Two implementations: a local viem account (dev / Key-Ring-held key) and a
 * Circle developer-controlled wallet. Both only ever call the MandateAccount (or permissionless CCTP mint);
 * the mandate on-chain is what bounds them.
 */
export interface AgentWallet {
  readonly kind: "local" | "circle";
  address(chainId: number): Promise<Address>;
  /** Sends a transaction and resolves once it is mined; returns the tx hash. */
  send(params: { chainId: number; to: Address; data: Hex; value?: bigint }): Promise<Hex>;
}
