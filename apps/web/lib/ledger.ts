"use client";
import type { Hex } from "viem";

/**
 * Guardian signer in the browser. Primary path: Ledger over WebHID via the Device Management Kit, clear-signing an
 * EIP-191 personal message (the Ethereum app renders ASCII messages in full — no blind signing needed).
 * Dev path: NEXT_PUBLIC_DEV_GUARDIAN_KEY signs locally so the flow can be exercised without a device.
 */
export interface GuardianSigner {
  kind: "ledger" | "dev";
  address(): Promise<Hex>;
  signMessage(text: string, onStatus?: (s: string) => void): Promise<Hex>;
}

const PATH = "44'/60'/0'/0/0";

export async function getGuardianSigner(): Promise<GuardianSigner> {
  const devKey = process.env.NEXT_PUBLIC_DEV_GUARDIAN_KEY as Hex | undefined;
  if (devKey) return devSigner(devKey);
  return ledgerSigner();
}

async function devSigner(key: Hex): Promise<GuardianSigner> {
  const { privateKeyToAccount } = await import("viem/accounts");
  const acct = privateKeyToAccount(key);
  return {
    kind: "dev",
    address: async () => acct.address,
    signMessage: async (text, onStatus) => {
      onStatus?.("dev signer (no device) — signing locally");
      return acct.signMessage({ message: text });
    },
  };
}

let dmkInstance: any;
let sessionId: string | undefined;

async function ledgerSigner(): Promise<GuardianSigner> {
  const { DeviceManagementKitBuilder, DeviceActionStatus } = await import("@ledgerhq/device-management-kit");
  const { webHidTransportFactory, webHidIdentifier } = await import("@ledgerhq/device-transport-kit-web-hid");
  const { SignerEthBuilder } = await import("@ledgerhq/device-signer-kit-ethereum");
  const { firstValueFrom } = await import("rxjs");

  if (!dmkInstance) dmkInstance = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
  const dmk = dmkInstance;

  async function connect(onStatus?: (s: string) => void) {
    if (sessionId) return sessionId;
    onStatus?.("Select your Ledger in the browser prompt…");
    const device = await firstValueFrom(dmk.startDiscovering({ transport: webHidIdentifier }));
    sessionId = await dmk.connect({ device });
    onStatus?.("Connected. Open the Ethereum app if prompted.");
    return sessionId!;
  }

  function run<T>(action: { observable: any }, onStatus?: (s: string) => void): Promise<T> {
    return new Promise((res, rej) =>
      action.observable.subscribe((state: any) => {
        if (state.status === DeviceActionStatus.Pending) {
          const step = state.intermediateValue?.requiredUserInteraction ?? state.intermediateValue?.step;
          if (step) onStatus?.(`Device: ${String(step).replace(/-/g, " ")}`);
        } else if (state.status === DeviceActionStatus.Completed) res(state.output as T);
        else if (state.status === DeviceActionStatus.Error) rej(new Error(state.error?.message ?? state.error?._tag ?? "device error"));
        else if (state.status === DeviceActionStatus.Stopped) rej(new Error("cancelled on device"));
      }),
    );
  }

  return {
    kind: "ledger",
    address: async () => {
      const sid = await connect();
      const signer = new SignerEthBuilder({ dmk, sessionId: sid }).build();
      const out = await run<{ address: Hex }>(signer.getAddress(PATH, { checkOnDevice: false }));
      return out.address;
    },
    signMessage: async (text, onStatus) => {
      const sid = await connect(onStatus);
      const signer = new SignerEthBuilder({ dmk, sessionId: sid }).build();
      onStatus?.("Review the approval text on your Ledger and approve.");
      const sig = await run<{ r: Hex; s: Hex; v: number }>(signer.signMessage(PATH, text), onStatus);
      const v = sig.v < 27 ? sig.v + 27 : sig.v;
      return `0x${sig.r.slice(2)}${sig.s.slice(2)}${v.toString(16).padStart(2, "0")}` as Hex;
    },
  };
}
