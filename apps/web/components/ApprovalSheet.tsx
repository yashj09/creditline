"use client";
import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { getGuardianSigner } from "@/lib/ledger";
import { Button, Card, Icon, Mono, Scribble, Sticky } from "@/components/ui";

interface ApprovalData {
  text: string;
  deadline: string;
  nonce: string;
  guardian: `0x${string}`;
  chainId: number;
  step: { index: number; title: string; description: string; maxUsdcOut: string; chainId: number };
}

/**
 * Renders when the agent asks to execute a guardian-gated step. Fetches the canonical approval text, has the
 * Ledger clear-sign it, stores the signature server-side, then resolves the AI SDK approval so the tool runs.
 */
export function ApprovalSheet(props: { planId: string; step: number; onDecision: (approved: boolean) => void }) {
  const [data, setData] = useState<ApprovalData | null>(null);
  const [status, setStatus] = useState<string>("Preparing approval text…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    // GET is idempotent server-side (cached per plan/step/nonce), so repeated mounts are harmless.
    fetch(`/api/approval?planId=${encodeURIComponent(props.planId)}&step=${props.step}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.text())))
      .then((d: ApprovalData) => { setData(d); setStatus("Waiting for your decision."); })
      .catch((e) => setError(String(e)));
  }, [props.planId, props.step]);

  async function approve() {
    if (!data) return;
    setBusy(true); setError(null);
    try {
      const signer = await getGuardianSigner();
      const addr = await signer.address();
      if (addr.toLowerCase() !== data.guardian.toLowerCase()) {
        throw new Error(`Connected signer ${addr} is not the guardian ${data.guardian}`);
      }
      const signature = await signer.signMessage(data.text, setStatus);
      const res = await fetch("/api/approval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: props.planId, step: props.step, signature }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? "approval rejected");
      setSigned(true);
      setStatus(signer.kind === "ledger" ? "Signed on Ledger. Releasing step to the agent…" : "Signed (dev signer). Releasing step…");
      props.onDecision(true);
    } catch (e) {
      setError((e as Error).message);
      setStatus("Not approved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone="warn" decoration="tack" padding="lg" className="my-4" role="region" aria-label="Guardian approval">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Icon icon={Fingerprint} size="sm" />
        <Sticky className="border-[3px]">Guardian required</Sticky>
        <h3 className="font-heading text-2xl">{data?.step.title ?? `Step ${props.step}`}</h3>
      </div>
      {data && <p className="mb-4 text-lg text-fg/80">{data.step.description}</p>}
      {data && (
        <div className="relative my-4">
          {/* The exact payload the Ledger displays and signs. Rendered verbatim; the contract rebuilds it. */}
          <Mono as="pre" block>{data.text}</Mono>
          <Scribble.CornerFrame className="text-ink" />
        </div>
      )}
      <p className="mb-5 text-base text-fg/70">This exact text is what your Ledger displays and signs. The contract rebuilds it and will refuse anything else.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!data || busy || signed} onClick={approve}>
          {busy ? "Waiting for device…" : signed ? "Approved" : "Approve on Ledger"}
        </Button>
        <Button variant="secondary" disabled={busy || signed} onClick={() => { setStatus("Denied."); props.onDecision(false); }}>
          Deny
        </Button>
        <span className="text-base text-fg/70">{status}</span>
      </div>
      {error && <p className="mt-3 text-base font-bold text-accent">{error}</p>}
    </Card>
  );
}
