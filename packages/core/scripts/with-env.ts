// Runs a command with the workspace-root .env injected. Usage: tsx scripts/with-env.ts [--cwd <dir>] -- <cmd> [args…]
import { config as loadEnv } from "dotenv";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
loadEnv({ path: resolve(process.cwd(), "../../.env"), override: false, quiet: true });
const args = process.argv.slice(2);
let cwd = process.cwd();
if (args[0] === "--cwd") { cwd = resolve(process.cwd(), args[1]!); args.splice(0, 2); }
if (args[0] === "--") args.shift();
const [cmd, ...rest] = args;
const r = spawnSync(cmd!, rest, { stdio: "inherit", cwd, env: process.env, shell: false });
process.exit(r.status ?? 1);
