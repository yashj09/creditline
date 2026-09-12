import { NextResponse } from "next/server";
import { cron } from "@/lib/agent";

/** Scheduler entry point (e.g. Vercel Cron). Protected by CRON_SECRET when set. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await cron(Number(process.env.REMIND_DAYS ?? 2))); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
