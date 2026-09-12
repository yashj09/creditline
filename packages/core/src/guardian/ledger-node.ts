import { dmkGuardian } from "./dmk.ts";
import type { GuardianSigner } from "./types.ts";

/**
 * Ledger over USB from Node.js. Optional peer deps:
 *   @ledgerhq/device-management-kit @ledgerhq/device-signer-kit-ethereum @ledgerhq/device-transport-kit-node-hid rxjs
 */
export function ledgerNodeGuardian(opts: { derivationPath?: string } = {}): GuardianSigner {
  let cached: { dmk: any; sessionId: string } | undefined;
  return dmkGuardian({
    kind: "ledger-node",
    derivationPath: opts.derivationPath,
    async connect(onStatus) {
      if (cached) return cached;
      const { DeviceManagementKitBuilder } = await import("@ledgerhq/device-management-kit");
      const { nodeHidTransportFactory } = await import("@ledgerhq/device-transport-kit-node-hid");
      const { firstValueFrom, filter, timeout } = await import("rxjs");
      const dmk = new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
      onStatus?.("Waiting for a Ledger over USB…");
      const devices: any[] = await firstValueFrom(dmk.listenToAvailableDevices({}).pipe(filter((d: any[]) => d.length > 0), timeout(60_000)));
      const sessionId: string = await dmk.connect({ device: devices[0] });
      onStatus?.("Connected. Open the Ethereum app if prompted.");
      cached = { dmk, sessionId };
      return cached;
    },
  });
}
