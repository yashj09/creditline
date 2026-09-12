import type { Address, Hex } from "viem";
import type { GuardianSigner } from "./types.ts";

/** Shared Ledger Device Management Kit glue; transports differ (USB in Node, WebHID in the browser). */
export function dmkGuardian(opts: {
  kind: string;
  derivationPath?: string;
  /** Returns a connected { dmk, sessionId }; cached by the caller. */
  connect: (onStatus?: (s: string) => void) => Promise<{ dmk: any; sessionId: string }>;
}): GuardianSigner {
  const path = opts.derivationPath ?? "44'/60'/0'/0/0";
  function run<T>(action: { observable: any }, onStatus?: (s: string) => void): Promise<T> {
    return new Promise(async (res, rej) => {
      const { DeviceActionStatus } = await import("@ledgerhq/device-management-kit");
      action.observable.subscribe((s: any) => {
        if (s.status === DeviceActionStatus.Pending) { const step = s.intermediateValue?.requiredUserInteraction ?? s.intermediateValue?.step; if (step) onStatus?.(`Device: ${String(step).replace(/-/g, " ")}`); }
        else if (s.status === DeviceActionStatus.Completed) res(s.output as T);
        else if (s.status === DeviceActionStatus.Error) rej(new Error(s.error?.message ?? s.error?._tag ?? "device error"));
        else if (s.status === DeviceActionStatus.Stopped) rej(new Error("cancelled on device"));
      });
    });
  }
  async function signer(onStatus?: (s: string) => void) {
    const { dmk, sessionId } = await opts.connect(onStatus);
    const { SignerEthBuilder } = await import("@ledgerhq/device-signer-kit-ethereum");
    return new SignerEthBuilder({ dmk, sessionId }).build();
  }
  return {
    kind: opts.kind,
    address: async () => (await run<{ address: Address }>((await signer()).getAddress(path, { checkOnDevice: false }))).address,
    signMessage: async (text, onStatus) => {
      const s = await signer(onStatus);
      onStatus?.("Review the approval text on your Ledger and approve.");
      const sig = await run<{ r: Hex; s: Hex; v: number }>(s.signMessage(path, text), onStatus);
      const v = sig.v < 27 ? sig.v + 27 : sig.v; // DMK returns 0/1 or 27/28 depending on version
      return `0x${sig.r.slice(2)}${sig.s.slice(2)}${v.toString(16).padStart(2, "0")}` as Hex;
    },
  };
}
