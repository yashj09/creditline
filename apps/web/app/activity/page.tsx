"use client";
import { useEffect, useState } from "react";
import { PlanCard } from "@/components/Cards";

export default function ActivityPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch("/api/plans").then((r) => r.json()).then(setData).catch(() => setData({ plans: [], audit: [] })); }, []);
  if (!data) return <p className="muted text-sm">loading…</p>;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide muted">Plans</h2>
        {data.plans.length === 0 && <p className="muted text-sm">No plans yet.</p>}
        {data.plans.map((p: any) => <PlanCard key={p.planId} plan={p} />)}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide muted">Audit trail</h2>
        <div className="panel divide-y text-xs" style={{ borderColor: "var(--border)" }}>
          {[...data.audit].reverse().map((e: any, i: number) => (
            <div key={i} className="p-3">
              <div className="flex justify-between"><span className="font-medium">{e.kind}</span><span className="muted">{new Date(e.ts).toLocaleString()}</span></div>
              <div>{e.summary}</div>
              <div className="muted mono">{e.planId}{e.step > 0 ? ` · step ${e.step}` : ""}{e.explorer && <> · <a className="underline" href={e.explorer} target="_blank" rel="noreferrer">tx ↗</a></>}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
