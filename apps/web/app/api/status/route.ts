import { NextResponse } from "next/server";
import { tools } from "@/lib/agent";

export async function GET() {
  try {
    const out = await (tools.get_positions as any).execute({}, { toolCallId: "status", messages: [] });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
