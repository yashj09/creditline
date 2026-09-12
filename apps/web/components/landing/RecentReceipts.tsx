"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Card, Mono, Pill, buttonClasses } from "@/components/ui";
import { auditTone } from "@/lib/sketch";

type Entry = { kind: string; ts: number | string; summary: string; planId?: string; step?: number; explorer?: string; txHash?: string };

/** Last three executed / guardian-approved audit entries, or an honest empty state. */
export function RecentReceipts() {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((d) => {
        const audit: Entry[] = Array.isArray(d?.audit) ? d.audit : [];
        setEntries(audit.filter((e) => e.kind === "execute" || e.kind === "guardian-approved").slice(-3).reverse());
      })
      .catch(() => setEntries([]));
  }, []);

  if (entries === null) return <Card padding="lg" className="animate-pulse text-lg text-fg/60" aria-busy="true">looking for receipts…</Card>;

  if (entries.length === 0) {
    return (
      <Card tone="postit" decoration="tape" padding="lg" className="text-lg">
        <p className="mb-4">No receipts yet — nothing has been executed on this deployment. Open the console to run the demo intent.</p>
        <Link href="/chat" className={buttonClasses("primary", "sm")}>Open the console</Link>
      </Card>
    );
  }

  return (
    <ol className="grid gap-6 md:grid-cols-3">
      {entries.map((e, i) => (
        <Card key={`${e.planId}-${e.step}-${i}`} as="li" padding="sm" rotate={i} className="text-base">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Pill tone={auditTone(e.kind)} filled>{e.kind}</Pill>
            <span className="text-sm text-fg/60">{new Date(e.ts).toLocaleString()}</span>
          </div>
          <Mono as="pre" block className="text-sm">{e.summary}</Mono>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg/60">
            <Mono tone="muted">{e.planId}{e.step ? ` · step ${e.step}` : ""}</Mono>
            {e.explorer && (
              <a className="inline-flex items-center gap-1 text-ink underline decoration-2 underline-offset-4 hover:decoration-wavy" href={e.explorer} target="_blank" rel="noreferrer">
                tx <ExternalLink size={13} strokeWidth={2.75} aria-hidden="true" />
              </a>
            )}
          </div>
        </Card>
      ))}
    </ol>
  );
}
