import type { Address } from "viem";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same on every EVM testnet incl. Arc (verified on-chain 2026-09-05). */
export const CCTP = {
  tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Address,
  messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Address,
  irisSandbox: "https://iris-api-sandbox.circle.com",
  /** Fast Transfer finality threshold (~8s from Base Sepolia). 2000 = standard (~15 min). */
  fastFinality: 1000,
  standardFinality: 2000,
} as const;

export const DOMAINS = { ethereumSepolia: 0, arbitrumSepolia: 3, baseSepolia: 6, arcTestnet: 26 } as const;

export const BASE_SEPOLIA = {
  chainId: 84532,
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  weth: "0x4200000000000000000000000000000000000006" as Address,
  comet: "0x571621Ce60Cebb0c1D442B5afb38B1663C6Bf017" as Address, // cUSDCv3
  domain: DOMAINS.baseSepolia,
} as const;

export const ARC_TESTNET = {
  chainId: 5042002,
  usdc: "0x3600000000000000000000000000000000000000" as Address, // ERC-20 view of native USDC
  domain: DOMAINS.arcTestnet,
} as const;

export const ARB_SEPOLIA = {
  chainId: 421614,
  usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address,
  weth: "0x1dF462e2712496373A347f8ad10802a5E95f053D" as Address,
  aavePool: "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff" as Address,
  domain: DOMAINS.arbitrumSepolia,
} as const;

export interface Deployment {
  chainId: number;
  factory: Address;
  account: Address;
  usdc: Address;
  nativeIsUsdc: boolean;
  owner: Address;
  guardian: Address;
  agent: Address;
}

/** Reads contracts/deployments/<name>.json written by script/Deploy.s.sol. */
export function loadDeployment(name: "base-sepolia" | "arc-testnet" | "arb-sepolia" | "arc"): Deployment | null {
  const p = resolve(import.meta.dirname, "../../../contracts/deployments", `${name}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Deployment;
}
