"use client";

export function VenueTable({ data }: { data: any }) {
  if (!data?.table) return null;
  return (
    <div className="panel my-2 overflow-x-auto p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide muted">Borrow rates · The Graph standardized subgraphs</div>
      <table className="w-full text-xs">
        <thead className="muted text-left"><tr><th className="py-1">Venue</th><th>Market</th><th>Borrow APR</th><th>Util</th><th>Available</th><th>Executes on</th></tr></thead>
        <tbody>
          {data.table.map((r: any) => (
            <tr key={r.venueId + r.market} style={r.venueId === data.recommended ? { color: "var(--ok)" } : undefined}>
              <td className="py-1 font-medium">{r.venueId}</td>
              <td className="muted">{r.market}</td>
              <td className="mono">{r.borrowAprPct}%</td>
              <td className="mono">{r.utilizationPct}%</td>
              <td className="mono">${r.availableUsd.toLocaleString()}</td>
              <td>{r.executableOn ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs">{data.explanation}</p>
      {data.warnings?.length ? <p className="mt-1 text-xs" style={{ color: "var(--warn)" }}>{data.warnings.join(" · ")}</p> : null}
    </div>
  );
}

export function PlanCard({ plan }: { plan: any }) {
  if (!plan?.steps) return null;
  return (
    <div className="panel my-2 p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-semibold">Plan {plan.planId} · via {plan.venue}</div>
        <div className="muted text-xs">HF {Number(plan.projected?.healthFactor).toFixed(2)} · liq @ ${Math.round(plan.projected?.liquidationPriceUsd ?? 0)} · {Number(plan.projected?.borrowAprPct).toFixed(2)}% APR</div>
      </div>
      <ol className="mt-2 space-y-2">
        {plan.steps.map((s: any) => (
          <li key={s.step} className="flex gap-3 text-sm">
            <span className="mono muted w-5 shrink-0">{s.step}.</span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.title}</span>
                <span className="pill" style={{ background: s.reversible ? "#1d3b2f" : "#3b2a1d", color: s.reversible ? "var(--ok)" : "var(--warn)" }}>{s.reversible ? "reversible" : "irreversible"}</span>
                {s.requiresGuardian && <span className="pill" style={{ background: "#2a2440", color: "var(--accent)" }}>Ledger tap</span>}
                <StatusPill status={s.status} />
              </div>
              <div className="muted text-xs">{s.description}</div>
              {s.explorer && <a className="text-xs underline" href={s.explorer} target="_blank" rel="noreferrer">{s.txHash?.slice(0, 18)}… ↗</a>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = { done: "var(--ok)", failed: "var(--bad)", executing: "var(--accent)", awaiting_guardian: "var(--warn)", simulated: "var(--muted)", pending: "var(--muted)" };
  return <span className="pill" style={{ border: `1px solid ${map[status] ?? "var(--muted)"}`, color: map[status] ?? "var(--muted)" }}>{status}</span>;
}

export function StepReceipt({ out }: { out: any }) {
  if (!out) return null;
  if (out.error) return <div className="panel my-2 p-3 text-sm" style={{ borderColor: "var(--bad)" }}>Step failed: {out.error}</div>;
  return (
    <div className="panel my-2 p-3 text-sm" style={{ borderColor: "var(--ok)" }}>
      <div className="font-medium">✓ {out.summary ?? out.title}</div>
      {out.explorer && <a className="text-xs underline" href={out.explorer} target="_blank" rel="noreferrer">{out.txHash} ↗</a>}
      {out.healthFactor && <div className="muted text-xs">Health factor {out.healthFactor} · liquidation at ${Math.round(out.liquidationPriceUsd ?? 0)}</div>}
    </div>
  );
}

export function SimulationCard({ data }: { data: any }) {
  if (!data?.results) return null;
  return (
    <div className="panel my-2 p-3 text-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide muted">Simulation</div>
      {data.results.map((r: any) => (
        <div key={r.step} className="flex gap-2"><span style={{ color: r.ok ? "var(--ok)" : "var(--bad)" }}>{r.ok ? "✓" : "✗"}</span><span>{r.step}. {r.title}</span>{r.revertReason && <span className="mono muted text-xs">{r.revertReason}</span>}</div>
      ))}
    </div>
  );
}

export function PositionsCard({ data }: { data: any }) {
  if (!data?.account) return null;
  return (
    <div className="panel my-2 grid grid-cols-2 gap-3 p-3 text-xs md:grid-cols-4">
      <div><div className="muted">Account</div><div className="mono">{data.account.slice(0, 10)}…</div></div>
      <div><div className="muted">Base Sepolia</div><div>{data.baseSepolia.eth} ETH · {data.baseSepolia.usdc} USDC</div></div>
      <div><div className="muted">Arc</div><div>{data.arc.usdcNative} USDC</div></div>
      <div><div className="muted">Compound</div><div>debt {data.compound.debtUsdc} · HF {data.compound.healthFactor}</div></div>
      <div><div className="muted">Mandate</div><div>{data.mandate.perTxCapUsdc}/tx · {data.mandate.dailyRemainingUsdc} left today</div></div>
      <div><div className="muted">Guardian</div><div className="mono">{data.guardian.slice(0, 10)}…</div></div>
      <div><div className="muted">Agent</div><div className="mono">{data.agent.slice(0, 10)}… ({data.agentWallet})</div></div>
      <div><div className="muted">Expires</div><div>{data.mandate.expiresAt ? new Date(data.mandate.expiresAt).toLocaleDateString() : "inactive"}</div></div>
    </div>
  );
}
