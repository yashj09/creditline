import { dmkGuardian } from "./guardian/dmk.ts";
import type { GuardianSigner } from "./guardian/types.ts";

let cached: { dmk: any; sessionId: string } | undefined;

/**
 * Ledger over WebHID in the browser (Chromium only). Clear-signs the approval text — no blind signing.
 * Optional peer deps: @ledgerhq/device-management-kit @ledgerhq/device-transport-kit-web-hid @ledgerhq/device-signer-kit-ethereum rxjs
 */
export function ledgerWebGuardian(opts: { derivationPath?: string } = {}): GuardianSigner {
  return dmkGuardian({
    kind: "ledger",
    derivationPath: opts.derivationPath,
    async connect(onStatus) {
      if (cached) return cached;
      const { DeviceManagementKitBuilder } = await import("@ledgerhq/device-management-kit");
      const { webHidTransportFactory, webHidIdentifier } = await import("@ledgerhq/device-transport-kit-web-hid");
      const { firstValueFrom } = await import("rxjs");
      const dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
      onStatus?.("Select your Ledger in the browser prompt…");
      const device = await firstValueFrom(dmk.startDiscovering({ transport: webHidIdentifier }));
      const sessionId: string = await dmk.connect({ device });
      onStatus?.("Connected. Open the Ethereum app if prompted.");
      cached = { dmk, sessionId };
      return cached;
    },
  });
}
export type { GuardianSigner };
