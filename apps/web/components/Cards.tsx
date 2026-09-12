"use client";
import { Check, Circle, ExternalLink, Fingerprint, X } from "lucide-react";
import { Card, Mono, Pill, Sticky } from "@/components/ui";
import { cx, statusTone } from "@/lib/sketch";

function TxLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-base text-ink underline decoration-2 decoration-ink underline-offset-4 hover:decoration-wavy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ExternalLink size={14} strokeWidth={2.75} aria-hidden="true" />
    </a>
  );
}

export function VenueTable({ data }: { data: any }) {
  if (!data?.table) return null;
  return (
    <Card padding="sm" className="my-3 overflow-x-auto">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Sticky>Borrow rates</Sticky>
        <span className="text-base text-fg/60">The Graph standardized subgraphs · mainnet rates, testnet execution</span>
      </div>
      <table className="w-full text-base">
        <thead className="text-left font-heading text-sm uppercase tracking-wide text-fg/60">
          <tr className="border-b-2 border-dashed border-fg/40">
            <th className="py-1 pr-3">Venue</th><th className="pr-3">Market</th><th className="pr-3">Borrow APR</th><th className="pr-3">Util</th><th className="pr-3">Available</th><th>Executes on</th>
          </tr>
        </thead>
        <tbody>
          {data.table.map((r: any) => {
            const recommended = r.venueId === data.recommended;
            return (
              <tr key={r.venueId + r.market} className={cx("border-b border-dotted border-fg/20 align-top", recommended && "bg-ink/10 font-bold")}>
                <td className="py-1.5 pr-3">
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {r.venueId}
                    {recommended && <Pill tone="ok" filled>recommended</Pill>}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-fg/70">{r.market}</td>
                <td className="py-1.5 pr-3 font-mono tabular-nums">{r.borrowAprPct}%</td>
                <td className="py-1.5 pr-3 font-mono tabular-nums">{r.utilizationPct}%</td>
                <td className="py-1.5 pr-3 font-mono tabular-nums">${r.availableUsd.toLocaleString()}</td>
                <td className="py-1.5">{r.executableOn ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-base">{data.explanation}</p>
      {data.warnings?.length ? (
        <Card tone="warn" padding="sm" className="mt-3 text-base">
          {data.warnings.join(" · ")}
        </Card>
      ) : null}
    </Card>
  );
}

export function PlanCard({ plan }: { plan: any }) {
  if (!plan?.steps) return null;
  return (
    <Card decoration="tape" className="my-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-heading text-xl">Plan {plan.planId} · via {plan.venue}</h3>
        <div className="font-mono text-sm text-fg/60 tabular-nums">
          HF {Number(plan.projected?.healthFactor).toFixed(2)} · liq @ ${Math.round(plan.projected?.liquidationPriceUsd ?? 0)} · {Number(plan.projected?.borrowAprPct).toFixed(2)}% APR
        </div>
      </div>
      <ol className="mt-3 space-y-3">
        {plan.steps.map((s: any) => (
          <li key={s.step} className="flex gap-3 text-lg">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center border-2 border-fg bg-card wobbly-pill font-heading text-base">{s.step}</span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{s.title}</span>
                <Pill tone={s.reversible ? "ok" : "warn"}>{s.reversible ? "reversible" : "irreversible"}</Pill>
                {s.requiresGuardian && (
                  <Pill tone="warn" filled>
                    <Fingerprint size={13} strokeWidth={2.75} aria-hidden="true" /> Ledger tap
                  </Pill>
                )}
                <StatusPill status={s.status} />
              </div>
              <div className="text-base text-fg/70">{s.description}</div>
              {s.explorer && (
                <TxLink href={s.explorer}>
                  <Mono>{s.txHash?.slice(0, 18)}…</Mono>
                </TxLink>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <Pill tone={statusTone(status)} filled={status === "done" || status === "failed"}>
      {status}
    </Pill>
  );
}

export function StepReceipt({ out }: { out: any }) {
  if (!out) return null;
  if (out.error) {
    return (
      <Card tone="bad" padding="sm" className="my-3 flex items-start gap-3 text-lg">
        <X size={22} strokeWidth={3} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <span>Step failed: {out.error}</span>
      </Card>
    );
  }
  return (
    <Card tone="ok" padding="sm" className="my-3 text-lg">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center border-2 border-ink bg-card wobbly-pill text-ink">
          <Check size={18} strokeWidth={3} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">{out.summary ?? out.title}</div>
          {out.explorer && (
            <TxLink href={out.explorer}>
              <Mono className="break-all">{out.txHash}</Mono>
            </TxLink>
          )}
          {out.healthFactor && (
            <div className="text-base text-fg/70 tabular-nums">Health factor {out.healthFactor} · liquidation at ${Math.round(out.liquidationPriceUsd ?? 0)}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function SimulationCard({ data }: { data: any }) {
  if (!data?.results) return null;
  return (
    <Card padding="sm" className="my-3 text-lg">
      <div className="mb-3"><Sticky>Simulation</Sticky></div>
      <ul className="space-y-1.5">
        {data.results.map((r: any) => (
          <li key={r.step} className="flex flex-wrap items-center gap-2">
            {!r.ok ? (
              <X size={20} strokeWidth={3} className="shrink-0 text-accent" aria-hidden="true" />
            ) : r.deferred ? (
              <Circle size={18} strokeWidth={3} className="shrink-0 text-fg/50" aria-hidden="true" />
            ) : (
              <Check size={20} strokeWidth={3} className="shrink-0 text-ink" aria-hidden="true" />
            )}
            <span>{r.step}. {r.title}</span>
            {r.deferred && <Pill tone="muted">allow-list checked · re-simulated before execution</Pill>}
            {r.revertReason && <Mono tone="muted" className="text-sm">{r.revertReason}</Mono>}
          </li>
        ))}
      </ul>
      {typeof data.verified === "number" && (
        <div className="mt-3 text-base text-fg/60">
          {data.verified} verified against live state · {data.deferred} depend on earlier steps · {data.failed} failing
        </div>
      )}
    </Card>
  );
}

function Stat({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-heading text-sm uppercase tracking-wide text-fg/60">{label}</div>
      <div className={cx("text-lg tabular-nums", mono && "font-mono text-base")}>{children}</div>
    </div>
  );
}

export function PositionsCard({ data }: { data: any }) {
  if (!data?.account) return null;
  return (
    <Card padding="sm" className="my-3 grid grid-cols-2 gap-4 md:grid-cols-4">
      <Stat label="Account" mono>{data.account.slice(0, 10)}…</Stat>
      <Stat label="Base Sepolia">{data.baseSepolia.eth} ETH · {data.baseSepolia.usdc} USDC</Stat>
      <Stat label="Arc">{data.arc.usdcNative} USDC</Stat>
      <Stat label="Compound">debt {data.compound.debtUsdc} · HF {data.compound.healthFactor}</Stat>
      <Stat label="Mandate">{data.mandate.perTxCapUsdc}/tx · {data.mandate.dailyRemainingUsdc} left today</Stat>
      <Stat label="Guardian" mono>{data.guardian.slice(0, 10)}…</Stat>
      <Stat label="Agent" mono>{data.agent.slice(0, 10)}… ({data.agentWallet})</Stat>
      <Stat label="Expires">{data.mandate.expiresAt ? new Date(data.mandate.expiresAt).toLocaleDateString() : "inactive"}</Stat>
    </Card>
  );
}
