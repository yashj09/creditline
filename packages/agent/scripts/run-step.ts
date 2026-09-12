// Executes one plan step through the same tool the chat/MCP use. Usage: tsx scripts/run-step.ts <planId> <step>
import { out, tools } from "./_client.ts";
const [planId, step] = process.argv.slice(2);
const r = await tools.execute_step!.execute({ planId, step: Number(step) }, { toolCallId: "cli", messages: [] });
out(r);
if (r?.ok === false || r?.error) process.exit(1);
