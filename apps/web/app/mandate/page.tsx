"use client";
import { useEffect, useState } from "react";
import { PositionsCard } from "@/components/Cards";
import { Button, Card, Input, Mono, Pill, SketchHeading } from "@/components/ui";
import { revokeMandate, setMandate } from "@/lib/owner";

const POLICY = [
  "Agent-only: wrap ETH, approve, supply collateral, borrow, repay, relay CCTP mint.",
  "Guardian (Ledger) required: CCTP burn, USDC transfer to anyone, native USDC payment on Arc.",
  "Caps apply to measured USDC outflow per step and per rolling 24h — enforced by the contract, not the agent.",
  "Owner can revoke the mandate or withdraw everything at any time.",
];

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

  const field = "mb-4 block text-base text-fg/70";

  return (
    <div className="space-y-6">
      <SketchHeading as="h1" underline="wavy">Your mandate</SketchHeading>
      <p className="max-w-3xl text-lg text-fg/70">
        You are the owner. Changes below are signed by your own browser wallet, never by the agent or the server. The same account address exists on Base Sepolia (borrowing) and Arc (settlement); set the mandate on both.
      </p>
      {err && <p className="text-lg font-bold text-accent">{err}</p>}
      {data && <PositionsCard data={data} />}

      <div className="grid gap-8 md:grid-cols-2">
        <Card decoration="tape">
          <h2 className="mb-4 font-heading text-2xl">Caps &amp; expiry</h2>
          <label className={field}>Per-transaction cap (USDC)
            <Input className="mt-1" type="number" value={form.perTx} onChange={(e) => setForm({ ...form, perTx: +e.target.value })} /></label>
          <label className={field}>Rolling 24h cap (USDC)
            <Input className="mt-1" type="number" value={form.daily} onChange={(e) => setForm({ ...form, daily: +e.target.value })} /></label>
          <label className={field}>Valid for (days)
            <Input className="mt-1" type="number" value={form.days} onChange={(e) => setForm({ ...form, days: +e.target.value })} /></label>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="sm" disabled={!!busy} onClick={() => apply(84532)}>Set on Base Sepolia</Button>
            <Button variant="primary" size="sm" disabled={!!busy} onClick={() => apply(5042002)}>Set on Arc</Button>
            <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => revoke(84532)}>Revoke (Base)</Button>
            <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => revoke(5042002)}>Revoke (Arc)</Button>
          </div>
          {busy && <p className="mt-3 animate-pulse text-base text-fg/60">{busy}</p>}
          {tx && <p className="mt-3 text-base">tx <Mono className="break-all">{tx}</Mono></p>}
        </Card>

        <Card decoration="tack">
          <h2 className="mb-3 font-heading text-2xl">Default policy</h2>
          <ul className="list-disc space-y-2 pl-5 text-base text-fg/80 marker:text-accent">
            {POLICY.map((t) => <li key={t}>{t}</li>)}
          </ul>
          <h2 className="mt-6 mb-3 font-heading text-2xl">Repayments</h2>
          {!repay?.due && <p className="text-base text-fg/60">{repay?.error ?? "No repayment intents due soon."}</p>}
          {repay?.due?.map((r: any) => (
            <div key={r.id} className="mb-2 flex flex-wrap items-center gap-2 text-base">
              <Pill tone={r.overdue ? "bad" : "warn"} filled>{r.overdue ? "overdue" : `due in ${r.daysLeft}d`}</Pill>
              <span>#{r.id} · {r.amountUsdc} USDC — ask the agent: “repay my loan”</span>
            </div>
          ))}
          {repay?.currentDebtUsdc && <p className="mt-3 text-base text-fg/60 tabular-nums">Current Compound debt {repay.currentDebtUsdc} USDC · HF {repay.healthFactor}</p>}
        </Card>
      </div>
    </div>
  );
}
