import type { Address, Hex } from "viem";
import type { GuardianSigner } from "./types.ts";

const PATH = "44'/60'/0'/0/0";

/**
 * Ledger over USB from Node.js (Device Management Kit + node-hid transport). Optional peer deps:
 *   @ledgerhq/device-management-kit @ledgerhq/device-signer-kit-ethereum @ledgerhq/device-transport-kit-node-hid rxjs
 * Clear-signs the approval text on the device; no blind signing needed.
 */
export function ledgerNodeGuardian(opts: { derivationPath?: string } = {}): GuardianSigner {
  const path = opts.derivationPath ?? PATH;
  let dmk: any; let sessionId: string | undefined;
  async function connect(onStatus?: (s: string) => void) {
    if (sessionId) return sessionId;
    const { DeviceManagementKitBuilder } = await import("@ledgerhq/device-management-kit");
    const { nodeHidTransportFactory } = await import("@ledgerhq/device-transport-kit-node-hid");
    const { firstValueFrom, filter, timeout } = await import("rxjs");
    dmk ??= new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
    onStatus?.("Waiting for a Ledger over USB…");
    const devices: any[] = await firstValueFrom(dmk.listenToAvailableDevices({}).pipe(filter((d: any[]) => d.length > 0), timeout(60_000)));
    sessionId = await dmk.connect({ device: devices[0] });
    onStatus?.("Connected. Open the Ethereum app if prompted.");
    return sessionId!;
  }
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
    const sid = await connect(onStatus);
    const { SignerEthBuilder } = await import("@ledgerhq/device-signer-kit-ethereum");
    return new SignerEthBuilder({ dmk, sessionId: sid }).build();
  }
  return {
    kind: "ledger-node",
    address: async () => (await run<{ address: Address }>((await signer()).getAddress(path, { checkOnDevice: false }))).address,
    signMessage: async (text, onStatus) => {
      const s = await signer(onStatus);
      onStatus?.("Review the approval text on your Ledger and approve.");
      const sig = await run<{ r: Hex; s: Hex; v: number }>(s.signMessage(path, text), onStatus);
      const v = sig.v < 27 ? sig.v + 27 : sig.v;
      return `0x${sig.r.slice(2)}${sig.s.slice(2)}${v.toString(16).padStart(2, "0")}` as Hex;
    },
  };
}
