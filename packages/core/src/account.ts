import { encodeAbiParameters, encodeFunctionData, getCreate2Address, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import { MandateAccountAbi } from "./abi/MandateAccount.ts";
import { MandateAccountBytecode } from "./abi/MandateAccountBytecode.ts";
import { MandateFactoryAbi } from "./abi/MandateFactory.ts";
import { erc20Abi, cometAbi, tokenMessengerV2Abi, messageTransmitterV2Abi, wethAbi } from "./abi/protocols.ts";
import { ARC_TESTNET, BASE_SEPOLIA, CCTP } from "./addresses.ts";
import { toFunctionSelector, getAbiItem } from "viem";

export interface PolicyInput { target: Address; selector: Hex; allowed: boolean; requiresGuardian: boolean }

const sel = (abi: any, name: string) => toFunctionSelector(getAbiItem({ abi, name }) as any);
const WILDCARD: Address = "0x0000000000000000000000000000000000000000";

/** Ready-made policies. Reversible protocol interactions are agent-only; anything that sends value away needs the guardian. */
export const policyPresets = {
  /** Compound v3 Base Sepolia borrowing + CCTP out + payments. */
  compoundV3BaseSepolia(): PolicyInput[] {
    const { weth, comet, usdc } = BASE_SEPOLIA;
    return [
      { target: weth, selector: sel(wethAbi, "deposit"), allowed: true, requiresGuardian: false },
      { target: weth, selector: sel(erc20Abi, "approve"), allowed: true, requiresGuardian: false },
      { target: comet, selector: sel(cometAbi, "supply"), allowed: true, requiresGuardian: false },
      { target: comet, selector: sel(cometAbi, "withdraw"), allowed: true, requiresGuardian: false },
      { target: usdc, selector: sel(erc20Abi, "approve"), allowed: true, requiresGuardian: false },
      { target: CCTP.tokenMessengerV2, selector: sel(tokenMessengerV2Abi, "depositForBurn"), allowed: true, requiresGuardian: true },
      { target: usdc, selector: sel(erc20Abi, "transfer"), allowed: true, requiresGuardian: true },
      { target: CCTP.messageTransmitterV2, selector: sel(messageTransmitterV2Abi, "receiveMessage"), allowed: true, requiresGuardian: false },
    ];
  },
  /** Arc: receive CCTP, pay anyone in native USDC (guardian), bridge back (guardian). */
  arcTestnet(): PolicyInput[] {
    const { usdc } = ARC_TESTNET;
    return [
      { target: CCTP.messageTransmitterV2, selector: sel(messageTransmitterV2Abi, "receiveMessage"), allowed: true, requiresGuardian: false },
      { target: usdc, selector: sel(erc20Abi, "approve"), allowed: true, requiresGuardian: false },
      { target: usdc, selector: sel(erc20Abi, "transfer"), allowed: true, requiresGuardian: true },
      { target: WILDCARD, selector: "0x00000000", allowed: true, requiresGuardian: true },
      { target: CCTP.tokenMessengerV2, selector: sel(tokenMessengerV2Abi, "depositForBurn"), allowed: true, requiresGuardian: true },
    ];
  },
  forChain(chainId: number): PolicyInput[] {
    if (chainId === BASE_SEPOLIA.chainId) return policyPresets.compoundV3BaseSepolia();
    if (chainId === ARC_TESTNET.chainId) return policyPresets.arcTestnet();
    throw new Error(`no policy preset for chain ${chainId}`);
  },
};

// ---- owner-side encoders (sign with any wallet: browser, Ledger, script) ----
export const ownerEncoders = {
  setMandate: (perTxCapUsdc6: bigint, dailyCapUsdc6: bigint, expiry: bigint) => encodeFunctionData({ abi: MandateAccountAbi, functionName: "setMandate", args: [perTxCapUsdc6, dailyCapUsdc6, expiry] }),
  revokeMandate: () => encodeFunctionData({ abi: MandateAccountAbi, functionName: "revokeMandate" }),
  setPolicies: (p: PolicyInput[]) => encodeFunctionData({ abi: MandateAccountAbi, functionName: "setPolicies", args: [p] }),
  setPolicy: (p: PolicyInput) => encodeFunctionData({ abi: MandateAccountAbi, functionName: "setPolicy", args: [p.target, p.selector, p.allowed, p.requiresGuardian] }),
  clearPolicy: (target: Address, selector: Hex) => encodeFunctionData({ abi: MandateAccountAbi, functionName: "clearPolicy", args: [target, selector] }),
  setGuardian: (g: Address) => encodeFunctionData({ abi: MandateAccountAbi, functionName: "setGuardian", args: [g] }),
  setAgent: (a: Address) => encodeFunctionData({ abi: MandateAccountAbi, functionName: "setAgent", args: [a] }),
  withdrawNative: (to: Address, amount: bigint) => encodeFunctionData({ abi: MandateAccountAbi, functionName: "withdrawNative", args: [to, amount] }),
  withdrawToken: (token: Address, to: Address, amount: bigint) => encodeFunctionData({ abi: MandateAccountAbi, functionName: "withdrawToken", args: [token, to, amount] }),
};

/** Calldata for MandateFactory.createAccount — same salt + roles on every chain gives the same address. */
export function encodeCreateAccount(owner: Address, guardian: Address, agent: Address, salt: Hex): Hex {
  return encodeFunctionData({ abi: MandateFactoryAbi, functionName: "createAccount", args: [owner, guardian, agent, salt] });
}

/** Deterministic account address for (factory, owner, guardian, agent, salt) — matches MandateFactory.computeAddress. */
export function computeAccountAddress(factory: Address, owner: Address, guardian: Address, agent: Address, salt: Hex): Address {
  const initCode = (MandateAccountBytecode + encodeAbiParameters(parseAbiParameters("address,address,address"), [owner, guardian, agent]).slice(2)) as Hex;
  return getCreate2Address({ from: factory, salt, bytecodeHash: keccak256(initCode) });
}
