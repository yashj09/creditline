import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { acceptGuardianSignature, getOrBuildApproval, plans } from "@/lib/agent";

/** GET /api/approval?planId=…&step=N → the exact text the Ledger must sign (idempotent per plan/step/nonce). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const planId = url.searchParams.get("planId");
  const step = Number(url.searchParams.get("step"));
  const plan = planId ? plans.get(planId) : null;
  const s = plan?.steps.find((x) => x.index === step);
  if (!plan || !s) return NextResponse.json({ error: "unknown plan/step" }, { status: 404 });
  try {
    const a = await getOrBuildApproval(plan, s);
    return NextResponse.json({ ...a, step: { index: s.index, title: s.title, description: s.description, maxUsdcOut: s.maxUsdcOut, chainId: s.chainId } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/approval { planId, step, signature } → verifies against the server-built text and on-chain guardian. */
export async function POST(req: Request) {
  const body = (await req.json()) as { planId: string; step: number; signature: Hex };
  const plan = plans.get(body.planId);
  const s = plan?.steps.find((x) => x.index === body.step);
  if (!plan || !s) return NextResponse.json({ error: "unknown plan/step" }, { status: 404 });
  if (!/^0x[0-9a-fA-F]{130}$/.test(body.signature ?? "")) return NextResponse.json({ error: "malformed signature" }, { status: 400 });
  try {
    await acceptGuardianSignature(plan, s, body.signature, "web");
    plans.save(plan);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
