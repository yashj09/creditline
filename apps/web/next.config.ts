import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// One .env at the workspace root serves contracts, core and web.
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@mandate/core", "@mandate/agent"],
  serverExternalPackages: ["@circle-fin/developer-controlled-wallets"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  agentRules: false,
};

export default nextConfig;
