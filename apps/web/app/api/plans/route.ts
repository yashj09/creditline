import { NextResponse } from "next/server";
import { getClient, summarizePlan } from "@/lib/agent";

export async function GET(req: Request) {
  const client = getClient();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const p = await client.store.plans.get(id);
    return p ? NextResponse.json({ plan: summarizePlan(p), audit: await client.store.audit.read(id) }) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ plans: (await client.store.plans.list()).map(summarizePlan), audit: (await client.store.audit.read()).slice(-100) });
}
