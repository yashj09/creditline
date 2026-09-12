"use client";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { PlanCard } from "@/components/Cards";
import { Card, Mono, Pill, Sticky } from "@/components/ui";
import { auditTone } from "@/lib/sketch";

export default function ActivityPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch("/api/plans").then((r) => r.json()).then(setData).catch(() => setData({ plans: [], audit: [] })); }, []);
  if (!data) return <p className="animate-pulse text-lg text-fg/60">loading…</p>;
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h2 className="mb-4"><Sticky rotate={1}>Plans</Sticky></h2>
        {data.plans.length === 0 && <p className="text-lg text-fg/60">No plans yet.</p>}
        {data.plans.map((p: any) => <PlanCard key={p.planId} plan={p} />)}
      </section>
      <section>
        <h2 className="mb-4"><Sticky rotate={2}>Audit trail</Sticky></h2>
        {data.audit.length === 0 && <p className="text-lg text-fg/60">Nothing recorded yet.</p>}
        {data.audit.length > 0 && (
          <Card padding="none" className="divide-y-2 divide-dashed divide-fg/40 text-base">
            {[...data.audit].reverse().map((e: any, i: number) => (
              <div key={i} className="p-3 md:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Pill tone={auditTone(e.kind)} filled>{e.kind}</Pill>
                  <span className="text-sm text-fg/60">{new Date(e.ts).toLocaleString()}</span>
                </div>
                <div className="mt-1.5 text-lg">{e.summary}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Mono tone="muted" className="text-sm">{e.planId}{e.step > 0 ? ` · step ${e.step}` : ""}</Mono>
                  {e.explorer && (
                    <a className="inline-flex items-center gap-1 text-sm text-ink underline decoration-2 underline-offset-4 hover:decoration-wavy" href={e.explorer} target="_blank" rel="noreferrer">
                      tx <ExternalLink size={13} strokeWidth={2.75} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
