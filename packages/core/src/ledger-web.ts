import type { Hex } from "viem";
import type { GuardianSigner } from "./guardian/types.ts";

const PATH = "44'/60'/0'/0/0";
let dmkInstance: any;
let sessionId: string | undefined;

/**
 * Ledger over WebHID in the browser (Chromium only). Clear-signs the approval text — no blind signing.
 * Optional peer deps: @ledgerhq/device-management-kit @ledgerhq/device-transport-kit-web-hid @ledgerhq/device-signer-kit-ethereum rxjs
 */
export function ledgerWebGuardian(opts: { derivationPath?: string } = {}): GuardianSigner {
  const path = opts.derivationPath ?? PATH;
  async function connect(onStatus?: (s: string) => void) {
    const { DeviceManagementKitBuilder } = await import("@ledgerhq/device-management-kit");
    const { webHidTransportFactory, webHidIdentifier } = await import("@ledgerhq/device-transport-kit-web-hid");
    const { firstValueFrom } = await import("rxjs");
    dmkInstance ??= new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
    if (sessionId) return sessionId;
    onStatus?.("Select your Ledger in the browser prompt…");
    const device = await firstValueFrom(dmkInstance.startDiscovering({ transport: webHidIdentifier }));
    sessionId = await dmkInstance.connect({ device });
    onStatus?.("Connected. Open the Ethereum app if prompted.");
    return sessionId!;
  }
  function run<T>(action: { observable: any }, onStatus?: (s: string) => void): Promise<T> {
    return new Promise(async (res, rej) => {
      const { DeviceActionStatus } = await import("@ledgerhq/device-management-kit");
      action.observable.subscribe((state: any) => {
        if (state.status === DeviceActionStatus.Pending) { const step = state.intermediateValue?.requiredUserInteraction ?? state.intermediateValue?.step; if (step) onStatus?.(`Device: ${String(step).replace(/-/g, " ")}`); }
        else if (state.status === DeviceActionStatus.Completed) res(state.output as T);
        else if (state.status === DeviceActionStatus.Error) rej(new Error(state.error?.message ?? state.error?._tag ?? "device error"));
        else if (state.status === DeviceActionStatus.Stopped) rej(new Error("cancelled on device"));
      });
    });
  }
  async function signer(onStatus?: (s: string) => void) {
    const sid = await connect(onStatus);
    const { SignerEthBuilder } = await import("@ledgerhq/device-signer-kit-ethereum");
    return new SignerEthBuilder({ dmk: dmkInstance, sessionId: sid }).build();
  }
  return {
    kind: "ledger",
    address: async () => (await run<{ address: Hex }>((await signer()).getAddress(path, { checkOnDevice: false }))).address,
    signMessage: async (text, onStatus) => {
      const s = await signer(onStatus);
      onStatus?.("Review the approval text on your Ledger and approve.");
      const sig = await run<{ r: Hex; s: Hex; v: number }>(s.signMessage(path, text), onStatus);
      const v = sig.v < 27 ? sig.v + 27 : sig.v;
      return `0x${sig.r.slice(2)}${sig.s.slice(2)}${v.toString(16).padStart(2, "0")}` as Hex;
    },
  };
}
export type { GuardianSigner };
