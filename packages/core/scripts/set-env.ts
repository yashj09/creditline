// Sets KEY=VALUE in the root .env (non-secret values only, e.g. deployed addresses). Usage: tsx scripts/set-env.ts KEY VALUE
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const [k, v] = process.argv.slice(2);
if (!k || v === undefined) throw new Error("usage: set-env KEY VALUE");
const p = resolve(process.cwd(), "../../.env");
let t = readFileSync(p, "utf8");
const re = new RegExp(`^${k}=.*$`, "m");
t = re.test(t) ? t.replace(re, `${k}=${v}`) : t.replace(/\n?$/, `\n${k}=${v}\n`);
writeFileSync(p, t);
console.log(`${k} set`);
