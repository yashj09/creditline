/**
 * Mandate without an LLM: plan → simulate → execute a liquidity flow under the on-chain mandate.
 * Env (root .env): MANDATE_ACCOUNT or deployments, AGENT_PRIVATE_KEY, GUARDIAN_PRIVATE_KEY (dev guardian), RECIPIENT.
 *   pnpm --filter example-node-script start
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
import type { Address, Hex } from "viem";
import { createMandateFromEnv, fileStore, localGuardian, recipes } from "@yashjain99/mandate-sdk";

const client = createMandateFromEnv({
  store: fileStore(resolve(process.cwd(), "../../.data")),
  // In production the guardian is a Ledger (ledgerNodeGuardian / ledgerWebGuardian). A raw key is for tests only.
  guardian: localGuardian(process.env.GUARDIAN_PRIVATE_KEY as Hex),
});

const amountUsdc = Number(process.env.AMOUNT_USDC ?? 3);
const recipient = process.env.RECIPIENT as Address;

console.log("positions:", (({ compound, mandate }) => ({ debt: compound.debtUsdc, hf: compound.healthFactor, perTx: mandate.perTxCapUsdc, dailyLeft: mandate.dailyRemainingUsdc }))(await client.positions()));

const { ranked } = await client.markets(amountUsdc);
console.log("venue:", ranked.recommended?.venueId, `${ranked.recommended?.borrowAprPct.toFixed(2)}% APR`);

const plan = await recipes.liquidity(client, { kind: "liquidity", amountUsdc, destinationChainId: 5042002, recipient, constraints: { doNotSell: ["ETH"] }, repayInDays: 7 }, { venueId: ranked.recommended?.venueId, borrowAprPct: ranked.recommended?.borrowAprPct });
console.log(`plan ${plan.id}: ${plan.steps.map((s) => `${s.index}.${s.kind}${s.requiresGuardian ? "🔐" : ""}`).join(" → ")}`);

const sim = await client.simulate(plan);
console.log(`simulation: ${sim.verified} verified, ${sim.deferred} deferred, ${sim.failed} failing`);
if (sim.failed) process.exit(1);

// executeAll signs guardian steps with the configured GuardianSigner and re-simulates each step against live state.
const results = await client.executeAll(plan, (r) => console.log(r.ok ? `  ✓ step ${r.step}: ${r.summary} ${r.explorer ?? ""}` : `  ✗ step ${r.step}: ${r.error}`));
console.log(results.every((r) => r.ok) ? "done" : "stopped");
