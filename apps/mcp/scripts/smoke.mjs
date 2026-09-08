import { spawn } from "node:child_process";
const p = spawn("pnpm", ["exec", "tsx", "src/server.ts"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
p.stdout.on("data", (d) => { buf += d.toString(); for (const line of buf.split("\n")) { if (!line.trim()) continue; try { const m = JSON.parse(line); if (m.id === 2) { console.log("tools:", m.result.tools.map((t) => t.name).join(", ")); p.kill(); process.exit(0); } } catch {} } });
const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 800);
setTimeout(() => { console.error("timeout"); p.kill(); process.exit(1); }, 20000);
