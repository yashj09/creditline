import { describe, expect, it } from "vitest";
import { approvalText, formatUsdc6 } from "../src/approval/message.ts";
import { callsHash } from "../src/exec/account.ts";

describe("approvalText mirrors MandateAccount.approvalText", () => {
  it("formats the fixture used in the Solidity test byte for byte", () => {
    const text = approvalText({
      account: "0x5c538163cd0934d079a438a8c8e3c5383aa6756d",
      chainId: 84532,
      planId: "0x0000000000000000000000000000000000000000000000000000000000000abc",
      step: 3,
      maxUsdcOut: 500_250_000n,
      callsHash: "0x0000000000000000000000000000000000000000000000000000000000001234",
      deadline: 1_757_000_000n,
      nonce: 7n,
    });
    expect(text).toBe(
      [
        "Mandate approval",
        "Account: 0x5c538163cd0934d079a438a8c8e3c5383aa6756d",
        "Chain: 84532",
        "Plan: 0x0000000000000000000000000000000000000000000000000000000000000abc",
        "Step: 3",
        "Max USDC out: 500.250000",
        "Calls: 0x0000000000000000000000000000000000000000000000000000000000001234",
        "Deadline: 1757000000",
        "Nonce: 7",
      ].join("\n"),
    );
  });

  it("formats USDC with six decimals", () => {
    expect(formatUsdc6(0n)).toBe("0.000000");
    expect(formatUsdc6(1n)).toBe("0.000001");
    expect(formatUsdc6(50_000_000n)).toBe("50.000000");
  });

  it("callsHash matches the Solidity fork-test value for the CCTP step", () => {
    // From ForkCompound.t.sol log: account 0x5c53…, approve(TM, 50e6) + depositForBurn(50e6, 26, acct, USDC, 0, 1e5, 1000)
    // We only assert determinism here; the cross-check against Solidity is done in the e2e script.
    const h1 = callsHash([{ target: "0x0000000000000000000000000000000000000001", value: 0n, data: "0x" }]);
    const h2 = callsHash([{ target: "0x0000000000000000000000000000000000000001", value: 0n, data: "0x" }]);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

import { encodeFunctionData, pad } from "viem";
import { erc20Abi, tokenMessengerV2Abi } from "../src/abi/protocols.ts";
import { CCTP, BASE_SEPOLIA } from "../src/addresses.ts";

describe("callsHash cross-check against Solidity (ForkCompound.t.sol log)", () => {
  it("reproduces 0xea84cb20… for the guardian-gated CCTP step", () => {
    const acct = "0x5c538163cd0934d079a438a8c8e3c5383aa6756d" as const;
    const calls = [
      { target: BASE_SEPOLIA.usdc, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CCTP.tokenMessengerV2, 50_000_000n] }) },
      {
        target: CCTP.tokenMessengerV2,
        value: 0n,
        data: encodeFunctionData({
          abi: tokenMessengerV2Abi,
          functionName: "depositForBurn",
          args: [50_000_000n, 26, pad(acct, { size: 32 }), BASE_SEPOLIA.usdc, pad("0x", { size: 32 }), 100_000n, 1000],
        }),
      },
    ];
    expect(callsHash(calls)).toBe("0xea84cb2039e4c361b83d8b01563cca770413e6bcb4aec2724247b4051f886f15");
  });
});
