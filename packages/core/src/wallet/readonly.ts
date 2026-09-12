import type { Address, Hex } from "viem";
import type { AgentWallet } from "./types.ts";

/**
 * A wallet that can report the agent address but never signs. Lets read-only surfaces (plan lists, approval text,
 * positions) run without the agent key; any attempt to execute fails with a clear message.
 */
export class ReadOnlyAgentWallet implements AgentWallet {
  readonly kind = "readonly" as const;
  constructor(private readonly resolveAddress: () => Promise<Address>) {}
  address(): Promise<Address> { return this.resolveAddress(); }
  async send(): Promise<Hex> { throw new Error("read-only mode: AGENT_PRIVATE_KEY (or Circle credentials) required to execute"); }
}
