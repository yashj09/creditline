"use client";
import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from "viem";
// Client bundle: import only browser-safe modules (no fs).
import { MandateAccountAbi } from "@mandate/core/src/abi/MandateAccount.ts";
import { chains } from "@mandate/core/src/chains.ts";

/**
 * Owner actions are signed by the user's own browser wallet (EIP-1193) — never by the server. The owner can tighten,
 * loosen or revoke the mandate and change the policy at any time; the agent cannot.
 */
export async function ownerClient(chainId: number) {
  const eth = (globalThis as any).ethereum;
  if (!eth) throw new Error("No browser wallet found. Install MetaMask/Rabby or use the forge scripts as owner.");
  const chain = chainId === 84532 ? chains.baseSepolia : chains.arcTestnet;
  const [account] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chain.id.toString(16)}` }] });
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: `0x${chain.id.toString(16)}`, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: [chain.blockExplorers?.default.url] }],
    });
  }
  const wallet = createWalletClient({ account, chain, transport: custom(eth) });
  const pub = createPublicClient({ chain, transport: http() });
  return { account, wallet, pub, chain };
}

export async function setMandate(chainId: number, accountAddr: Address, perTxUsdc: number, dailyUsdc: number, expiryDays: number): Promise<Hex> {
  const { wallet, pub } = await ownerClient(chainId);
  const hash = await wallet.writeContract({
    address: accountAddr, abi: MandateAccountAbi, functionName: "setMandate",
    args: [BigInt(Math.round(perTxUsdc * 1e6)), BigInt(Math.round(dailyUsdc * 1e6)), BigInt(Math.floor(Date.now() / 1000) + expiryDays * 86400)],
  });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export async function revokeMandate(chainId: number, accountAddr: Address): Promise<Hex> {
  const { wallet, pub } = await ownerClient(chainId);
  const hash = await wallet.writeContract({ address: accountAddr, abi: MandateAccountAbi, functionName: "revokeMandate" });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export async function setPolicy(chainId: number, accountAddr: Address, target: Address, selector: Hex, allowed: boolean, requiresGuardian: boolean): Promise<Hex> {
  const { wallet, pub } = await ownerClient(chainId);
  const hash = await wallet.writeContract({ address: accountAddr, abi: MandateAccountAbi, functionName: "setPolicy", args: [target, selector, allowed, requiresGuardian] });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
