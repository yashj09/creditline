/**
 * One-time Circle developer-controlled wallets setup for the agent.
 *   pnpm exec tsx scripts/circle-setup.ts --register   # first time: registers the entity secret with Circle (saves recovery file)
 *   pnpm exec tsx scripts/circle-setup.ts              # creates a wallet set + one EOA wallet on BASE-SEPOLIA and ARC-TESTNET
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET (32-byte hex; generate with `openssl rand -hex 32`).
 * Prints CIRCLE_WALLET_SET_ID and the agent addresses to put in .env.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
if (!apiKey || !entitySecret) throw new Error("set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in .env");

const sdk = await import("@circle-fin/developer-controlled-wallets");

if (process.argv.includes("--register")) {
  await sdk.registerEntitySecretCiphertext({ apiKey, entitySecret, recoveryFileDownloadPath: resolve(process.cwd(), "../../.data") });
  console.log("entity secret registered; recovery file saved under .data/ — keep it private");
}

const client = sdk.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
const ws = await client.createWalletSet({ name: `mandate-agent-${Date.now()}` });
const walletSetId = ws.data?.walletSet?.id as string;
const created = await client.createWallets({ walletSetId, blockchains: ["BASE-SEPOLIA", "ARC-TESTNET"] as any, count: 1, accountType: "EOA" });
console.log("\nAdd to .env:");
console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
for (const w of created.data?.wallets ?? []) console.log(`# ${w.blockchain}: ${w.address}`);
console.log(`AGENT_ADDRESS=${created.data?.wallets?.[0]?.address}   # same address on both chains for EOA wallets`);
