"use client";
import { useEffect, useState } from "react";
import { getGuardianSigner } from "@/lib/ledger";

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
        body: JSON.stringify({ planId: props.planId, step: props.step, text: data.text, signature, deadline: data.deadline, nonce: data.nonce, guardian: data.guardian }),
      });
      if (!res.ok) throw new Error(await res.text());
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
    <div className="panel my-2 p-4" style={{ borderColor: "var(--warn)" }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="pill" style={{ background: "var(--warn)", color: "#0b0d12" }}>GUARDIAN REQUIRED</span>
        <span className="text-sm font-semibold">{data?.step.title ?? `Step ${props.step}`}</span>
      </div>
      {data && <p className="muted mb-3 text-sm">{data.step.description}</p>}
      {data && (
        <pre className="mono mb-3 whitespace-pre-wrap rounded-lg p-3 text-xs" style={{ background: "#0b0d12", border: "1px solid var(--border)" }}>
          {data.text}
        </pre>
      )}
      <p className="muted mb-3 text-xs">This exact text is what your Ledger displays and signs. The contract rebuilds it and will refuse anything else.</p>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary disabled:opacity-50" disabled={!data || busy || signed} onClick={approve}>
          {busy ? "Waiting for device…" : signed ? "Approved" : "Approve on Ledger"}
        </button>
        <button className="btn btn-ghost disabled:opacity-50" disabled={busy || signed} onClick={() => { setStatus("Denied."); props.onDecision(false); }}>
          Deny
        </button>
        <span className="muted text-xs">{status}</span>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: "var(--bad)" }}>{error}</p>}
    </div>
  );
}
