import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentWallet } from "./types.ts";

/** viem-backed agent wallet. In production the key comes from `wallet-cli ring decrypt`, never from .env. */
export class LocalAgentWallet implements AgentWallet {
  readonly kind = "local" as const;
  private readonly account;
  constructor(privateKey: Hex, private readonly chains: Record<number, Chain>) {
    this.account = privateKeyToAccount(privateKey);
  }

  async address(): Promise<Address> {
    return this.account.address;
  }

  async send({ chainId, to, data, value }: { chainId: number; to: Address; data: Hex; value?: bigint }): Promise<Hex> {
    const chain = this.chains[chainId];
    if (!chain) throw new Error(`no chain config for ${chainId}`);
    const wallet = createWalletClient({ account: this.account, chain, transport: http() });
    const pub = createPublicClient({ chain, transport: http() });
    const hash = await wallet.sendTransaction({ to, data, value: value ?? 0n });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
    return hash;
  }
}
