"use client";
import { useEffect, useState } from "react";
import { VenueTable } from "@/components/Cards";
import { Card, Pill } from "@/components/ui";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; data: any; at: string };

/** Live venue table for the landing: the same tool output the agent reasons over in chat. */
export function LiveRates() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    fetch("/api/markets?amountUsdc=100")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error ?? r.statusText);
        return j;
      })
      .then((data) => setState({ kind: "ok", data, at: new Date().toLocaleTimeString() }))
      .catch((e) => setState({ kind: "error", message: (e as Error).message }));
  }, []);

  if (state.kind === "loading") {
    return (
      <Card padding="lg" className="animate-pulse text-lg text-fg/60" aria-busy="true">
        asking The Graph for live USDC borrow rates…
      </Card>
    );
  }
  if (state.kind === "error") {
    return (
      <Card tone="warn" padding="lg" className="text-lg">
        Rates unavailable right now — the console still works. <span className="text-base text-fg/60">({state.message})</span>
      </Card>
    );
  }
  return (
    <div>
      <VenueTable data={state.data} />
      <div className="mt-2 flex flex-wrap items-center gap-3 text-base text-fg/60">
        {state.data.recommended && <Pill tone="ok" filled>recommended: {state.data.recommended}</Pill>}
        <span>fetched at {state.at} · mainnet rates inform, testnet twins execute</span>
      </div>
    </div>
  );
}
