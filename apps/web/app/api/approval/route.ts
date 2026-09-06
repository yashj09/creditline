import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { buildApproval, verifyApproval } from "@/lib/agent";
import { approvals, audit, plans } from "@/lib/agent";

/** GET /api/approval?planId=…&step=N → the exact text the Ledger must sign. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const planId = url.searchParams.get("planId");
  const step = Number(url.searchParams.get("step"));
  const plan = planId ? plans.get(planId) : null;
  const s = plan?.steps.find((x) => x.index === step);
  if (!plan || !s) return NextResponse.json({ error: "unknown plan/step" }, { status: 404 });
  const a = await buildApproval(plan, s);
  audit.write({ planId: plan.id, step, kind: "guardian-request", chainId: s.chainId, summary: `Guardian approval requested: ${s.title}`, data: { text: a.text } });
  return NextResponse.json({ ...a, step: { index: s.index, title: s.title, description: s.description, maxUsdcOut: s.maxUsdcOut, chainId: s.chainId } });
}

/** POST /api/approval { planId, step, text, signature, deadline, nonce } → stores the verified guardian signature. */
export async function POST(req: Request) {
  const body = (await req.json()) as { planId: string; step: number; text: string; signature: Hex; deadline: string; nonce: string; guardian: Hex };
  const plan = plans.get(body.planId);
  const s = plan?.steps.find((x) => x.index === body.step);
  if (!plan || !s) return NextResponse.json({ error: "unknown plan/step" }, { status: 404 });
  const ok = await verifyApproval(body.guardian, body.text, body.signature);
  if (!ok) return NextResponse.json({ error: "signature does not recover to the guardian" }, { status: 400 });
  approvals.put({ ...body, signedAt: new Date().toISOString() });
  s.status = "awaiting_guardian";
  plans.save(plan);
  audit.write({ planId: plan.id, step: body.step, kind: "guardian-approved", chainId: s.chainId, summary: `Guardian ${body.guardian} signed step ${body.step} on Ledger` });
  return NextResponse.json({ ok: true });
}
