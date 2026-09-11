import { createPublicClient, http, type Address, type Hex, type PublicClient } from "viem";
import {
  MandateAccountAbi,
  CircleAgentWallet,
  LocalAgentWallet,
  chains,
  loadDeployment,
  type AgentWallet,
  type Deployment,
} from "@mandate/core";

export interface Runtime {
  base: Deployment;
  arc: Deployment;
  account: Address;
  /** Live on-chain guardian for the account on a given chain (the contract is the source of truth). */
  guardian: (chainId?: number) => Promise<Address>;
  agent: Address;
  wallet: AgentWallet;
  basePub: PublicClient;
  arcPub: PublicClient;
}

let cached: Runtime | null = null;

/** Lazily wires chain clients, deployments and the agent wallet. Throws a clear message when not deployed yet. */
export async function getRuntime(): Promise<Runtime> {
  if (cached) return cached;
  const base = loadDeployment("base-sepolia");
  const arc = loadDeployment("arc-testnet");
  if (!base || !arc) {
    throw new Error("Contracts are not deployed yet. Run script/Deploy.s.sol on base_sepolia and arc_testnet (see README).");
  }
  if (base.account.toLowerCase() !== arc.account.toLowerCase()) {
    throw new Error("MandateAccount address differs between Base Sepolia and Arc — redeploy with the same salt and args.");
  }
  const chainMap = { [chains.baseSepolia.id]: chains.baseSepolia, [chains.arcTestnet.id]: chains.arcTestnet };
  const useCircle = !!(process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET && process.env.CIRCLE_WALLET_SET_ID);
  const wallet: AgentWallet = useCircle
    ? new CircleAgentWallet({
        apiKey: process.env.CIRCLE_API_KEY!,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
        walletSetId: process.env.CIRCLE_WALLET_SET_ID!,
      })
    : new LocalAgentWallet(requireEnv("AGENT_PRIVATE_KEY") as Hex, chainMap);

  const basePub = createPublicClient({ chain: chains.baseSepolia, transport: http() });
  const arcPub = createPublicClient({ chain: chains.arcTestnet, transport: http() });
  const guardian = (chainId?: number) =>
    (chainId === chains.arcTestnet.id ? arcPub : basePub).readContract({ address: base.account, abi: MandateAccountAbi, functionName: "guardian" });
  // The guardian is per-contract storage. A split configuration would make Arc approvals fail after the user has
  // already tapped the device, so refuse to run until the owner aligns both chains.
  const [gBase, gArc] = await Promise.all([guardian(chains.baseSepolia.id), guardian(chains.arcTestnet.id)]);
  if (gBase.toLowerCase() !== gArc.toLowerCase()) {
    throw new Error(`Guardian differs across chains (Base ${gBase}, Arc ${gArc}). Run setGuardian on both chains with the same address.`);
  }
  cached = {
    base,
    arc,
    account: base.account,
    guardian,
    agent: await wallet.address(chains.baseSepolia.id),
    wallet,
    basePub,
    arcPub,
  };
  return cached;
}

export function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}
