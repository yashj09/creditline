// dev-only: signs the approval text with GUARDIAN_PRIVATE_KEY and posts it (prints only ok/error)
import { privateKeyToAccount } from "viem/accounts";
const [planId, step] = process.argv.slice(2);
const a = await (await fetch(`http://localhost:3000/api/approval?planId=${planId}&step=${step}`)).json() as any;
if (!a.text) throw new Error(`no approval text: ${JSON.stringify(a)}`);
const acct = privateKeyToAccount(process.env.GUARDIAN_PRIVATE_KEY as `0x${string}`);
const signature = await acct.signMessage({ message: a.text });
const res = await fetch("http://localhost:3000/api/approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId, step: Number(step), signature }) });
console.log("POST /api/approval →", res.status, await res.text());
