"use client";
import { useEffect, useState } from "react";
import { PositionsCard } from "@/components/Cards";
import { revokeMandate, setMandate } from "@/lib/owner";

export default function MandatePage() {
  const [data, setData] = useState<any>(null);
  const [repay, setRepay] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ perTx: 100, daily: 500, days: 7 });
  const [busy, setBusy] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const load = () => {
    fetch("/api/status").then(async (r) => (r.ok ? r.json() : Promise.reject(await r.text()))).then(setData).catch((e) => setErr(String(e)));
    fetch("/api/cron").then((r) => r.json()).then(setRepay).catch(() => null);
  };
  useEffect(load, []);

  async function apply(chainId: number) {
    if (!data) return;
    setBusy(`Signing setMandate on ${chainId === 84532 ? "Base Sepolia" : "Arc"}…`); setErr(null);
    try { setTx(await setMandate(chainId, data.account, form.perTx, form.daily, form.days)); load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  async function revoke(chainId: number) {
    if (!data) return;
    setBusy("Revoking…"); setErr(null);
    try { setTx(await revokeMandate(chainId, data.account)); load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Your mandate</h1>
      <p className="muted text-sm">You are the owner. Changes below are signed by your own browser wallet, never by the agent or the server. The same account address exists on Base Sepolia (borrowing) and Arc (settlement); set the mandate on both.</p>
      {err && <p className="text-sm" style={{ color: "var(--bad)" }}>{err}</p>}
      {data && <PositionsCard data={data} />}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-4 text-sm">
          <div className="mb-3 font-semibold">Caps & expiry</div>
          <label className="mb-2 block text-xs muted">Per-transaction cap (USDC)
            <input className="panel mt-1 w-full px-3 py-2" type="number" value={form.perTx} onChange={(e) => setForm({ ...form, perTx: +e.target.value })} /></label>
          <label className="mb-2 block text-xs muted">Rolling 24h cap (USDC)
            <input className="panel mt-1 w-full px-3 py-2" type="number" value={form.daily} onChange={(e) => setForm({ ...form, daily: +e.target.value })} /></label>
          <label className="mb-3 block text-xs muted">Valid for (days)
            <input className="panel mt-1 w-full px-3 py-2" type="number" value={form.days} onChange={(e) => setForm({ ...form, days: +e.target.value })} /></label>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary text-xs" disabled={!!busy} onClick={() => apply(84532)}>Set on Base Sepolia</button>
            <button className="btn btn-primary text-xs" disabled={!!busy} onClick={() => apply(5042002)}>Set on Arc</button>
            <button className="btn btn-ghost text-xs" disabled={!!busy} onClick={() => revoke(84532)}>Revoke (Base)</button>
            <button className="btn btn-ghost text-xs" disabled={!!busy} onClick={() => revoke(5042002)}>Revoke (Arc)</button>
          </div>
          {busy && <p className="muted mt-2 text-xs">{busy}</p>}
          {tx && <p className="mono mt-2 text-xs">tx {tx}</p>}
        </div>

        <div className="panel p-4 text-sm">
          <div className="mb-2 font-semibold">Default policy</div>
          <ul className="muted space-y-1 text-xs">
            <li>• Agent-only: wrap ETH, approve, supply collateral, borrow, repay, relay CCTP mint.</li>
            <li>• Guardian (Ledger) required: CCTP burn, USDC transfer to anyone, native USDC payment on Arc.</li>
            <li>• Caps apply to measured USDC outflow per step and per rolling 24h — enforced by the contract, not the agent.</li>
            <li>• Owner can revoke the mandate or withdraw everything at any time.</li>
          </ul>
          <div className="mt-4 mb-2 font-semibold">Repayments</div>
          {!repay?.due && <p className="muted text-xs">{repay?.error ?? "No repayment intents due soon."}</p>}
          {repay?.due?.map((r: any) => (
            <div key={r.id} className="text-xs" style={{ color: r.overdue ? "var(--bad)" : "var(--warn)" }}>
              #{r.id} · {r.amountUsdc} USDC · {r.overdue ? "overdue" : `due in ${r.daysLeft}d`} — ask the agent: “repay my loan”
            </div>
          ))}
          {repay?.currentDebtUsdc && <p className="muted mt-2 text-xs">Current Compound debt {repay.currentDebtUsdc} USDC · HF {repay.healthFactor}</p>}
        </div>
      </div>
    </div>
  );
}
