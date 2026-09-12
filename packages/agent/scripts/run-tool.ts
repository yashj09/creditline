// Calls any agent tool with a JSON input. Usage: tsx scripts/run-tool.ts <tool> '<json>'
import { out, tools } from "./_client.ts";
const [name, json] = process.argv.slice(2);
const t = tools[name!];
if (!t) throw new Error(`unknown tool ${name}; have: ${Object.keys(tools).join(", ")}`);
out(await t.execute(json ? JSON.parse(json) : {}, { toolCallId: "cli", messages: [] }));
