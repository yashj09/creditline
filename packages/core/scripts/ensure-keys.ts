/**
 * Fills missing agent / dev-guardian keys in the root .env without ever printing private keys.
 * - AGENT_PRIVATE_KEY / AGENT_ADDRESS: generated if empty.
 * - GUARDIAN_PRIVATE_KEY: generated if empty. The existing GUARDIAN_ADDRESS (your Ledger) is preserved as
 *   LEDGER_GUARDIAN_ADDRESS and GUARDIAN_ADDRESS is pointed at the dev key so the scripted e2e can sign;
 *   switch back with `setGuardian(LEDGER_GUARDIAN_ADDRESS)` for the Ledger demo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const path = resolve(process.cwd(), "../../.env");
let text = readFileSync(path, "utf8");
const get = (k: string) => text.match(new RegExp(`^${k}=([^\\s#]*)`, "m"))?.[1] ?? "";
const set = (k: string, v: string) => {
  const re = new RegExp(`^${k}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${k}=${v}`) : text + `\n${k}=${v}`;
};
const empty = (v: string) => v === "" || v === "0x";
const out: string[] = [];

if (empty(get("AGENT_PRIVATE_KEY"))) {
  const pk = generatePrivateKey();
  set("AGENT_PRIVATE_KEY", pk);
  set("AGENT_ADDRESS", privateKeyToAccount(pk).address);
  out.push(`generated agent key → AGENT_ADDRESS=${privateKeyToAccount(pk).address}`);
} else if (empty(get("AGENT_ADDRESS"))) {
  set("AGENT_ADDRESS", privateKeyToAccount(get("AGENT_PRIVATE_KEY") as `0x${string}`).address);
  out.push(`derived AGENT_ADDRESS=${get("AGENT_ADDRESS")}`);
}

if (empty(get("GUARDIAN_PRIVATE_KEY"))) {
  const pk = generatePrivateKey();
  const dev = privateKeyToAccount(pk).address;
  const ledger = get("GUARDIAN_ADDRESS");
  if (!empty(ledger) && ledger.toLowerCase() !== dev.toLowerCase()) {
    set("LEDGER_GUARDIAN_ADDRESS", ledger);
    out.push(`kept your Ledger address as LEDGER_GUARDIAN_ADDRESS=${ledger}`);
  }
  set("GUARDIAN_PRIVATE_KEY", pk);
  set("GUARDIAN_ADDRESS", dev);
  out.push(`generated dev guardian → GUARDIAN_ADDRESS=${dev} (for the scripted e2e; switch to the Ledger later)`);
}
writeFileSync(path, text.endsWith("\n") ? text : text + "\n");
console.log(out.length ? out.join("\n") : "nothing to generate");
console.log(`OWNER_ADDRESS=${get("OWNER_ADDRESS")}  AGENT_ADDRESS=${get("AGENT_ADDRESS")}  GUARDIAN_ADDRESS=${get("GUARDIAN_ADDRESS")}  RECIPIENT=${get("RECIPIENT")}`);
const missing = ["DEPLOYER_PRIVATE_KEY","OWNER_PRIVATE_KEY","OWNER_ADDRESS","GRAPH_API_KEY","TOOL_APPROVAL_SECRET"].filter((k) => empty(get(k)));
const model = !empty(get("ANTHROPIC_API_KEY")) ? "anthropic" : !empty(get("AWS_ACCESS_KEY_ID")) ? "bedrock" : "NONE";
console.log(`model provider: ${model}${missing.length ? `\nSTILL EMPTY: ${missing.join(", ")}` : ""}`);
