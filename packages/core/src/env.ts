import type { Address, Hex } from "viem";
import { chains } from "./chains.ts";
import { loadDeployment } from "./addresses.ts";
import { createMandate, type MandateClient, type MandateConfig } from "./client.ts";
import { fileStore } from "./store/file.ts";
import { memoryStore } from "./store/memory.ts";
import { CircleAgentWallet } from "./wallet/circle.ts";
import { LocalAgentWallet } from "./wallet/local.ts";
import { localGuardian } from "./guardian/local.ts";

/**
 * Node-only convenience: build a client from environment variables (the web console, the MCP server and the examples use it).
 *   MANDATE_ACCOUNT (alias: ACCOUNT; or contracts/deployments/*.json via MANDATE_DEPLOYMENTS_DIR)
 *   BASE_SEPOLIA_RPC / ARC_TESTNET_RPC (or MANDATE_RPC_84532 / MANDATE_RPC_5042002)
 *   AGENT_PRIVATE_KEY  or  CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET + CIRCLE_WALLET_SET_ID
 *   MANDATE_STORE_DIR (file store) — default in-memory
 *   GRAPH_API_KEY, MANDATE_GUARDIAN_KEY (dev guardian; NOT for real funds)
 */
export function createMandateFromEnv(overrides: Partial<MandateConfig> & { env?: NodeJS.ProcessEnv } = {}): MandateClient {
  const env = overrides.env ?? process.env;
  const account = (overrides.account ?? env.MANDATE_ACCOUNT ?? env.ACCOUNT ?? loadDeployment("base-sepolia")?.account) as Address | undefined;
  if (!account) throw new Error("MANDATE_ACCOUNT not set and no deployments found");
  const rpc = (id: number, legacy?: string) => env[`MANDATE_RPC_${id}`] ?? (legacy ? env[legacy] : undefined);
  const chainsCfg = overrides.chains ?? {
    [chains.baseSepolia.id]: { chain: chains.baseSepolia, rpc: rpc(84532, "BASE_SEPOLIA_RPC") },
    [chains.arcTestnet.id]: { chain: chains.arcTestnet, rpc: rpc(5042002, "ARC_TESTNET_RPC") },
  };
  const useCircle = !!(env.CIRCLE_API_KEY && env.CIRCLE_ENTITY_SECRET && env.CIRCLE_WALLET_SET_ID);
  const wallet = overrides.wallet ?? (useCircle
    ? new CircleAgentWallet({ apiKey: env.CIRCLE_API_KEY!, entitySecret: env.CIRCLE_ENTITY_SECRET!, walletSetId: env.CIRCLE_WALLET_SET_ID! })
    : new LocalAgentWallet(requireEnv(env, "AGENT_PRIVATE_KEY") as Hex, Object.fromEntries(Object.entries(chainsCfg).map(([id, c]) => [Number(id), c.chain]))));
  const store = overrides.store ?? (env.MANDATE_STORE_DIR ? fileStore(env.MANDATE_STORE_DIR) : memoryStore());
  const guardian = overrides.guardian ?? (env.MANDATE_GUARDIAN_KEY ? localGuardian(env.MANDATE_GUARDIAN_KEY as Hex) : undefined);
  return createMandate({ ...overrides, chains: chainsCfg, account, wallet, store, guardian, graphApiKey: overrides.graphApiKey ?? env.GRAPH_API_KEY });
}

function requireEnv(env: NodeJS.ProcessEnv, k: string): string {
  const v = env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}
