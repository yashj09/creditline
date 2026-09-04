import type { Address, Hex } from "viem";
import type { AgentWallet } from "./types.ts";

type Blockchain = "BASE-SEPOLIA" | "ARC-TESTNET" | "ARB-SEPOLIA";
const CHAIN_TO_CIRCLE: Record<number, Blockchain> = { 84532: "BASE-SEPOLIA", 5042002: "ARC-TESTNET", 421614: "ARB-SEPOLIA" };

/**
 * Circle developer-controlled wallet as the agent's signer (Circle Agent Stack / Arc track).
 * Uses raw contract-execution transactions; Circle handles nonce, gas and broadcast.
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID (created once by `scripts/circle-setup.ts`).
 */
export class CircleAgentWallet implements AgentWallet {
  readonly kind = "circle" as const;
  private client: any;
  private wallets = new Map<Blockchain, { id: string; address: Address }>();

  constructor(private readonly cfg: { apiKey: string; entitySecret: string; walletSetId: string }) {}

  private async sdk() {
    if (!this.client) {
      const mod = await import("@circle-fin/developer-controlled-wallets");
      this.client = mod.initiateDeveloperControlledWalletsClient({
        apiKey: this.cfg.apiKey,
        entitySecret: this.cfg.entitySecret,
      });
    }
    return this.client;
  }

  private async wallet(chainId: number) {
    const bc = CHAIN_TO_CIRCLE[chainId];
    if (!bc) throw new Error(`Circle wallets: unsupported chain ${chainId}`);
    const cached = this.wallets.get(bc);
    if (cached) return cached;
    const sdk = await this.sdk();
    const res = await sdk.listWallets({ walletSetId: this.cfg.walletSetId, blockchain: bc });
    const w = res.data?.wallets?.[0];
    if (!w) throw new Error(`no Circle wallet on ${bc} in wallet set ${this.cfg.walletSetId}`);
    const entry = { id: w.id as string, address: w.address as Address };
    this.wallets.set(bc, entry);
    return entry;
  }

  async address(chainId: number): Promise<Address> {
    return (await this.wallet(chainId)).address;
  }

  async send({ chainId, to, data, value }: { chainId: number; to: Address; data: Hex; value?: bigint }): Promise<Hex> {
    const sdk = await this.sdk();
    const w = await this.wallet(chainId);
    const res = await sdk.createContractExecutionTransaction({
      walletId: w.id,
      contractAddress: to,
      callData: data,
      amount: value && value > 0n ? (Number(value) / 1e18).toString() : undefined,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
    const id = res.data?.id as string;
    // poll until mined
    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline) {
      const tx = await sdk.getTransaction({ id });
      const t = tx.data?.transaction;
      if (t?.state === "COMPLETE" || t?.state === "CONFIRMED") return t.txHash as Hex;
      if (t?.state === "FAILED" || t?.state === "DENIED" || t?.state === "CANCELLED") {
        throw new Error(`Circle tx ${id} ${t.state}: ${t.errorReason ?? ""}`);
      }
      await new Promise((r) => setTimeout(r, 2_500));
    }
    throw new Error(`Circle tx ${id} timed out`);
  }
}
