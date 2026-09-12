import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// One .env at the workspace root serves contracts, core and web.
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@yashjain99/mandate-sdk", "@yashjain99/mandate-ai"],
  serverExternalPackages: ["@circle-fin/developer-controlled-wallets", "@ledgerhq/device-transport-kit-node-hid", "node-hid", "usb"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  agentRules: false,
};

export default nextConfig;
