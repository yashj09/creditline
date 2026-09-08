/**
 * Repayment reminder job. Reads repayment intents from the Arc account, writes reminders to the audit log for anything
 * due within REMIND_DAYS (default 2) or overdue, and prints them. Run via `pnpm --filter @mandate/agent cron`
 * (or hit /api/cron on the web app from a scheduler). Execution of the reverse leg always goes through the agent +
 * guardian flow — the cron never moves money by itself.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
import { runRepaymentCheck } from "../src/cron.ts";

const out = await runRepaymentCheck(Number(process.env.REMIND_DAYS ?? 2));
console.log(JSON.stringify(out, null, 2));
