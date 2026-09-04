import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
  parseAbiParameters,
} from "viem";
import { MandateAccountAbi } from "../abi/MandateAccount.ts";

/** Mirrors `MandateAccount.Call`. */
export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

/** keccak256(abi.encode(calls)) — identical to the Solidity `callsHash`. */
export function callsHash(calls: Call[]): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("(address target, uint256 value, bytes data)[]"), [calls]),
  );
}

export function encodeExecute(calls: Call[], planId: Hex, step: number): Hex {
  return encodeFunctionData({ abi: MandateAccountAbi, functionName: "execute", args: [calls, planId, step] });
}

export function encodeExecuteWithGuardian(
  calls: Call[],
  maxUsdcOut: bigint,
  planId: Hex,
  step: number,
  deadline: bigint,
  signature: Hex,
): Hex {
  return encodeFunctionData({
    abi: MandateAccountAbi,
    functionName: "executeWithGuardian",
    args: [calls, maxUsdcOut, planId, step, deadline, signature],
  });
}

export function encodeScheduleRepayment(dueAt: bigint, amount: bigint, venue: Address): Hex {
  return encodeFunctionData({
    abi: MandateAccountAbi,
    functionName: "scheduleRepayment",
    args: [dueAt, amount, venue],
  });
}

/** Turns a human-readable plan id (e.g. a UUID) into the bytes32 the contract stores. */
export function planIdToBytes32(id: string): Hex {
  return keccak256(new TextEncoder().encode(id));
}
