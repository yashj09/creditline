import { client } from "./_client.ts";
const p = await client.store.plans.get(process.argv[2]!);
console.log(p ? p.steps.map((s) => `${s.index}:${s.status}`).join(" ") : "no plan");
