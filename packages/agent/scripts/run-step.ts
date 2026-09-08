// Executes one plan step through the same tool the chat/MCP use. Usage: tsx scripts/run-step.ts <planId> <step>
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
const { tools } = await import("../src/tools.ts");
const [planId, step] = process.argv.slice(2);
const out = await (tools.execute_step as any).execute({ planId, step: Number(step) }, { toolCallId: "cli", messages: [] });
console.log(JSON.stringify(out, null, 2));
if (out?.ok === false || out?.error) process.exit(1);
