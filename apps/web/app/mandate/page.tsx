"use client";
import { useEffect, useState } from "react";
import { PositionsCard } from "@/components/Cards";

/** Read-only view of the on-chain mandate for now; owner editing lands with the settings work. */
export default function MandatePage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetch("/api/status").then(async (r) => (r.ok ? r.json() : Promise.reject(await r.text()))).then(setData).catch((e) => setErr(String(e))); }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Your mandate</h1>
      {err && <p className="text-sm" style={{ color: "var(--bad)" }}>{err}</p>}
      {data && <PositionsCard data={data} />}
      <div className="panel p-4 text-sm">
        <div className="mb-2 font-semibold">Default policy</div>
        <ul className="muted space-y-1 text-xs">
          <li>• Agent-only: wrap ETH, approve, supply collateral, borrow, repay, relay CCTP mint.</li>
          <li>• Guardian (Ledger) required: CCTP burn, USDC transfer to anyone, native USDC payment on Arc.</li>
          <li>• Caps apply to measured USDC outflow per step and per rolling 24h.</li>
          <li>• Owner can revoke the mandate or withdraw everything at any time.</li>
        </ul>
      </div>
    </div>
  );
}
