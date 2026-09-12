/**
 * A Mandate agent in ~50 lines with the Vercel AI SDK. Any model; guardian steps pause until a signature is supplied.
 *   pnpm --filter example-vercel-ai-agent start "I need 3 USDC on Arc to pay 0x… Don't sell my ETH."
 * Env: ANTHROPIC_API_KEY or AWS Bedrock creds, plus the Mandate env (see node-script). DEV_GUARDIAN_KEY auto-signs (tests only).
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { Hex } from "viem";
import { createMandateFromEnv, fileStore, localGuardian } from "@yashjain99/mandate-sdk";
import { MANDATE_SYSTEM_PROMPT, mandateTools } from "@yashjain99/mandate-ai";

const devKey = process.env.DEV_GUARDIAN_KEY ?? process.env.GUARDIAN_PRIVATE_KEY;
const client = createMandateFromEnv({
  store: fileStore(resolve(process.cwd(), "../../.data")),
  guardian: devKey ? localGuardian(devKey as Hex) : undefined, // no guardian configured → execute_step returns awaitingGuardian
});
const model = process.env.ANTHROPIC_API_KEY ? anthropic("claude-opus-5") : createAmazonBedrock({ region: process.env.AWS_REGION ?? "us-east-1" })(process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-haiku-4-5-20251001-v1:0");

const prompt = process.argv.slice(2).join(" ") || "Show my positions and the cheapest USDC borrow rate for 3 USDC.";
const messages: ModelMessage[] = [{ role: "user", content: prompt }];

const result = await generateText({
  model,
  system: MANDATE_SYSTEM_PROMPT,
  messages,
  tools: mandateTools(client),
  stopWhen: stepCountIs(12),
  onStepFinish: ({ toolCalls, toolResults }) => {
    for (const c of toolCalls) console.log(`→ ${c.toolName}(${JSON.stringify(c.input)})`);
    for (const r of toolResults as any[]) if (r.output?.awaitingGuardian) console.log("⏸ guardian approval required — sign with your Ledger and call execute_step again");
  },
});
console.log("\n" + result.text);
