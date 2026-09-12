import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentWallet } from "./types.ts";

/** viem-backed agent wallet. In production the key comes from `wallet-cli ring decrypt`, never from .env. */
export type WalletChainConfig = Chain | { chain: Chain; rpc?: string };

export class LocalAgentWallet implements AgentWallet {
  readonly kind = "local" as const;
  private readonly account;
  private readonly chains: Record<number, { chain: Chain; rpc?: string }>;
  constructor(privateKey: Hex, chains: Record<number, WalletChainConfig>) {
    this.account = privateKeyToAccount(privateKey);
    this.chains = Object.fromEntries(Object.entries(chains).map(([id, c]) => [Number(id), "chain" in c ? c : { chain: c }]));
  }

  async address(): Promise<Address> {
    return this.account.address;
  }

  async send({ chainId, to, data, value }: { chainId: number; to: Address; data: Hex; value?: bigint }): Promise<Hex> {
    const cfg = this.chains[chainId];
    if (!cfg) throw new Error(`no chain config for ${chainId}`);
    const wallet = createWalletClient({ account: this.account, chain: cfg.chain, transport: http(cfg.rpc) });
    const pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) });
    const hash = await wallet.sendTransaction({ to, data, value: value ?? 0n });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
    return hash;
  }
}
