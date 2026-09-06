import { NextResponse } from "next/server";
import { audit, plans } from "@/lib/agent";
import { summarizePlan } from "@/lib/agent";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const p = plans.get(id);
    return p ? NextResponse.json({ plan: summarizePlan(p), audit: audit.read(id) }) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ plans: plans.list().map(summarizePlan), audit: audit.read().slice(-100) });
}
