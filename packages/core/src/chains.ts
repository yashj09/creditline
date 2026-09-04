import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { defineChain, type Chain } from "viem";

/** Circle Arc testnet — USDC is the native gas token (18-dec native, 6-dec ERC-20 view at 0x3600…). */
export const arcTestnet: Chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});

export const chains = {
  baseSepolia: {
    ...baseSepolia,
    rpcUrls: { default: { http: [process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org"] } },
  } as Chain,
  arcTestnet,
  arbitrumSepolia: {
    ...arbitrumSepolia,
    rpcUrls: { default: { http: [process.env.ARB_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc"] } },
  } as Chain,
} as const;

export type ChainKey = keyof typeof chains;

export function chainByKey(key: ChainKey): Chain {
  return chains[key];
}

export function explorerTx(chain: Chain, hash: string): string {
  return `${chain.blockExplorers?.default.url}/tx/${hash}`;
}
