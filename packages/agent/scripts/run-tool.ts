// Calls any agent tool with a JSON input. Usage: tsx scripts/run-tool.ts <tool> '<json>'
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
const { tools } = await import("../src/tools.ts");
const [name, json] = process.argv.slice(2);
const t = (tools as any)[name!];
if (!t) throw new Error(`unknown tool ${name}; have: ${Object.keys(tools).join(", ")}`);
const out = await t.execute(json ? JSON.parse(json) : {}, { toolCallId: "cli", messages: [] });
console.log(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
