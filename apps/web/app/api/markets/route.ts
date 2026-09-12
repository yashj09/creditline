import { NextResponse } from "next/server";
import { tools } from "@/lib/agent";

export const dynamic = "force-dynamic";

/** Live venue table for the landing page; same tool the agent calls in chat. */
export async function GET(req: Request) {
  const amount = Number(new URL(req.url).searchParams.get("amountUsdc") ?? 100) || 100;
  try {
    const out = await (tools.get_markets as any).execute({ amountUsdc: amount }, { toolCallId: "markets", messages: [] });
    return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
