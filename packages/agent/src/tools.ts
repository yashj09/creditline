import { tool } from "ai";
import { z } from "zod";
import { formatUnits, type Address, type Hex } from "viem";
import {
  ARC_TESTNET,
  BASE_SEPOLIA,
  CCTP,
  IntentSchema,
  RepayIntentSchema,
  buildRepaymentPlan,
  MandateAccountAbi,
  buildLiquidityPlan,
  encodeExecute,
  encodeExecuteWithGuardian,
  encodeReceiveMessage,
  encodeScheduleRepayment,
  explorerTx,
  fetchMarkets,
  planIdToBytes32,
  rankVenues,
  readCometPosition,
  simulateStep,
  usdcBalance,
  waitForAttestation,
  chains,
  type Plan,
  type Step,
} from "@mandate/core";
import { getRuntime } from "./runtime.ts";
import { approvals, audit, plans } from "./store.ts";

const fmtUsdc = (v: bigint) => Number(formatUnits(v, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 });

export const tools = {
  get_positions: tool({
    description:
      "Read the user's MandateAccount: balances on Base Sepolia and Arc, Compound v3 position (debt, collateral, health factor), mandate caps and remaining daily allowance, guardian and agent addresses. Call this first.",
    inputSchema: z.object({}),
    execute: async () => {
      const rt = await getRuntime();
      const [ethBase, usdcBase, usdcArc, nativeArc, pos, mandate, dailyRemaining, nonce, guardian] = await Promise.all([
        rt.basePub.getBalance({ address: rt.account }),
        usdcBalance(rt.basePub, BASE_SEPOLIA.usdc, rt.account),
        usdcBalance(rt.arcPub, ARC_TESTNET.usdc, rt.account),
        rt.arcPub.getBalance({ address: rt.account }),
        readCometPosition(rt.basePub, rt.account),
        rt.basePub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "mandate" }),
        rt.basePub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "dailyRemaining" }),
        rt.basePub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "guardianNonce" }),
        rt.guardian(),
      ]);
      const [perTxCap, dailyCap, expiry] = mandate;
      return {
        account: rt.account,
        agent: rt.agent,
        agentWallet: rt.wallet.kind,
        guardian,
        baseSepolia: { ethWei: ethBase.toString(), eth: Number(formatUnits(ethBase, 18)).toFixed(4), usdc: fmtUsdc(usdcBase) },
        arc: { usdcErc20: fmtUsdc(usdcArc), usdcNative: Number(formatUnits(nativeArc, 18)).toFixed(2) },
        compound: {
          debtUsdc: fmtUsdc(pos.debtUsdc),
          collateralWeth: Number(formatUnits(pos.collateralWeth, 18)).toFixed(4),
          wethPriceUsd: pos.wethPriceUsd,
          healthFactor: Number.isFinite(pos.healthFactor) ? pos.healthFactor.toFixed(2) : "∞",
          liquidationPriceUsd: pos.liquidationPriceUsd,
          borrowAprPct: pos.borrowAprPct.toFixed(2),
          liquidateCollateralFactor: pos.liquidateCollateralFactor,
        },
        mandate: {
          perTxCapUsdc: fmtUsdc(perTxCap),
          dailyCapUsdc: fmtUsdc(dailyCap),
          dailyRemainingUsdc: fmtUsdc(dailyRemaining),
          expiresAt: expiry === 0n ? null : new Date(Number(expiry) * 1000).toISOString(),
          active: expiry !== 0n && Number(expiry) * 1000 > Date.now(),
          guardianNonce: nonce.toString(),
        },
      };
    },
  }),

  get_markets: tool({
    description:
      "Live USDC borrow rates across lending protocols via The Graph's Messari standardized subgraphs (Aave v3, Compound v3, Spark) plus Morpho, ranked for the requested amount. Mainnet rates inform the decision; execution happens on the venue's testnet twin.",
    inputSchema: z.object({ amountUsdc: z.number().positive() }),
    execute: async ({ amountUsdc }) => {
      const rt = await getRuntime();
      const key = process.env.GRAPH_API_KEY;
      const snap = key
        ? await fetchMarkets({ graphApiKey: key, baseSepoliaClient: rt.basePub })
        : { fetchedAt: new Date().toISOString(), rates: [], warnings: ["GRAPH_API_KEY not set — standardized subgraphs skipped"] };
      if (!key) {
        // still show the executable twin + Morpho so the agent can proceed honestly
        const { fetchMorphoUsdcRates } = await import("@mandate/core");
        try { snap.rates.push(...(await fetchMorphoUsdcRates())); } catch (e) { snap.warnings.push(String((e as Error).message)); }
        const pos = await readCometPosition(rt.basePub, rt.account);
        snap.rates.push({
          venueId: "compound-v3-base-sepolia", protocol: "compound-v3", network: "base-sepolia", chainId: 84532,
          marketName: "cUSDCv3 (testnet twin of Compound v3 Base)", asset: "USDC",
          borrowAprPct: pos.borrowAprPct, supplyAprPct: pos.supplyAprPct, utilizationPct: pos.utilizationPct,
          availableUsd: Number(pos.availableUsdc) / 1e6, totalBorrowUsd: 0, totalDepositUsd: Number(pos.availableUsdc) / 1e6,
          source: "messari-standardized", observedAt: Math.floor(Date.now() / 1000),
          executable: { chainId: 84532, network: "base-sepolia", note: "Compound v3 Base Sepolia lends real Circle USDC; CCTP Fast Transfer to Arc in ~8s" },
        });
      }
      const ranked = rankVenues(snap, amountUsdc);
      return {
        fetchedAt: snap.fetchedAt,
        table: ranked.table.map((r) => ({
          venueId: r.venueId, protocol: r.protocol, network: r.network, market: r.marketName,
          borrowAprPct: +r.borrowAprPct.toFixed(3), supplyAprPct: +r.supplyAprPct.toFixed(3), utilizationPct: +r.utilizationPct.toFixed(1),
          availableUsd: Math.round(r.availableUsd), source: r.source, executableOn: r.executable?.network ?? null,
        })),
        cheapestMainnet: ranked.cheapestMainnet?.venueId ?? null,
        recommended: ranked.recommended?.venueId ?? null,
        explanation: ranked.explanation,
        warnings: snap.warnings,
      };
    },
  }),

  draft_plan: tool({
    description:
      "Turn the user's intent into a concrete, deterministic plan (typed steps with calls, reversibility and guardian requirements). Requires get_markets first. Returns the plan with projected health factor and liquidation price.",
    inputSchema: z.object({ intent: IntentSchema }),
    execute: async ({ intent }) => {
      const rt = await getRuntime();
      const key = process.env.GRAPH_API_KEY;
      const snap = key ? await fetchMarkets({ graphApiKey: key, baseSepoliaClient: rt.basePub }) : await (async () => {
        const pos = await readCometPosition(rt.basePub, rt.account);
        return { fetchedAt: new Date().toISOString(), warnings: ["GRAPH_API_KEY not set"], rates: [{
          venueId: "compound-v3-base-sepolia", protocol: "compound-v3" as const, network: "base-sepolia", chainId: 84532,
          marketName: "cUSDCv3", asset: "USDC", borrowAprPct: pos.borrowAprPct, supplyAprPct: pos.supplyAprPct, utilizationPct: pos.utilizationPct,
          availableUsd: Number(pos.availableUsdc) / 1e6, totalBorrowUsd: 0, totalDepositUsd: 0, source: "messari-standardized" as const,
          executable: { chainId: 84532, network: "base-sepolia", note: "testnet twin" },
        }] };
      })();
      const ranked = rankVenues(snap, intent.amountUsdc);
      const mandate = await rt.basePub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "mandate" });
      const id = `plan-${Date.now().toString(36)}`;
      const plan = await buildLiquidityPlan({ id, intent, account: rt.account, ranked, baseSepolia: rt.basePub, perTxCapUsdc6: mandate[0] });
      plans.save(plan);
      audit.write({ planId: id, step: 0, kind: "plan", summary: `Plan drafted: ${plan.steps.map((s) => s.title).join(" → ")}`, data: { venue: plan.venueId } });
      return summarizePlan(plan);
    },
  }),

  simulate_plan: tool({
    description: "Dry-run every step of a plan against the chain (policy, caps, protocol logic). Always call before executing.",
    inputSchema: z.object({ planId: z.string() }),
    execute: async ({ planId }) => {
      const rt = await getRuntime();
      const plan = plans.get(planId);
      if (!plan) return { error: `unknown plan ${planId}` };
      const results = [];
      let priorDone = true;
      for (const step of plan.steps) {
        if (step.status === "done") { results.push({ step: step.index, title: step.title, ok: true, notes: ["already executed"] }); continue; }
        const pub = step.chainId === 84532 ? rt.basePub : rt.arcPub;
        const sim = await simulateStep(pub, step, { account: rt.account, agent: rt.agent, owner: rt.base.owner, planId: planIdToBytes32(plan.id), priorStepsDone: priorDone });
        step.simulation = sim;
        if (step.status !== "executing" && step.status !== "awaiting_guardian") step.status = sim.ok ? "simulated" : "failed";
        results.push({ step: step.index, title: step.title, ok: sim.ok, deferred: sim.deferred, revertReason: sim.revertReason, notes: sim.notes });
        priorDone = false; // only the first not-yet-executed step gets a dynamic simulation
      }
      plans.save(plan);
      audit.write({ planId, step: 0, kind: "simulate", summary: `Simulation: ${results.filter((r) => r.ok).length}/${results.length} steps ok` });
      return { planId, results };
    },
  }),

  execute_step: tool({
    description:
      "Execute one plan step in order. Steps flagged requiresGuardian pause for the user's Ledger approval before running; the signature is attached automatically once the user has signed. Returns the transaction hash and explorer link.",
    inputSchema: z.object({ planId: z.string(), step: z.number().int().min(1) }),
    execute: async ({ planId, step: idx }) => {
      const rt = await getRuntime();
      const plan = plans.get(planId);
      if (!plan) return { error: `unknown plan ${planId}` };
      const step = plan.steps.find((s) => s.index === idx);
      if (!step) return { error: `plan ${planId} has no step ${idx}` };
      const prev = plan.steps.find((s) => s.index === idx - 1);
      if (prev && prev.status !== "done") return { error: `step ${idx - 1} must complete first (status: ${prev.status})` };
      if (step.status === "done") return { ok: true, alreadyDone: true, txHash: step.txHash, explorer: step.explorer };

      const chain = step.chainId === 84532 ? chains.baseSepolia : chains.arcTestnet;
      const planIdHex = planIdToBytes32(plan.id);
      step.status = "executing";
      plans.save(plan);
      try {
        let txHash: Hex;
        let summary = step.title;
        if (step.kind === "bridge_relay") {
          const burn = plan.steps.find((s) => s.kind === "bridge_burn" && s.index < step.index);
          if (!burn?.txHash) throw new Error("bridge burn tx missing");
          const srcDomain = burn.chainId === 84532 ? BASE_SEPOLIA.domain : ARC_TESTNET.domain;
          const dstPub = step.chainId === 84532 ? rt.basePub : rt.arcPub;
          const dstUsdc = step.chainId === 84532 ? BASE_SEPOLIA.usdc : ARC_TESTNET.usdc;
          const att = await waitForAttestation(srcDomain, burn.txHash as Hex, { timeoutMs: 4 * 60_000 });
          const before = await usdcBalance(dstPub, dstUsdc, rt.account);
          txHash = await rt.wallet.send({ chainId: chain.id, to: CCTP.messageTransmitterV2, data: encodeReceiveMessage(att) });
          let after = before;
          for (let i = 0; i < 6 && after <= before; i++) { // public RPCs can lag the receipt by a few seconds
            await new Promise((r) => setTimeout(r, 2_500));
            after = await usdcBalance(dstPub, dstUsdc, rt.account);
          }
          summary = `Minted ${fmtUsdc(after - before)} USDC on ${chain.name}`;
        } else if (step.kind === "mark_repaid") {
          if (!step.direct) throw new Error("mark_repaid step missing calldata");
          txHash = await rt.wallet.send({ chainId: chain.id, to: step.direct.to as Address, data: step.direct.data as Hex });
          summary = step.title;
        } else if (step.kind === "schedule_repayment") {
          if (plan.intent.kind !== "liquidity") throw new Error("schedule_repayment only applies to liquidity plans");
          const dueAt = BigInt(Math.floor(Date.now() / 1000) + plan.intent.repayInDays * 86400);
          const amount = BigInt(Math.round(plan.intent.amountUsdc * 1e6));
          txHash = await rt.wallet.send({ chainId: chain.id, to: rt.account, data: encodeScheduleRepayment(dueAt, amount, BASE_SEPOLIA.comet) });
          summary = `Repayment of ${plan.intent.amountUsdc} USDC scheduled for ${new Date(Number(dueAt) * 1000).toDateString()}`;
        } else {
          const calls = step.calls.map((c) => ({ target: c.target as Address, value: BigInt(c.value), data: c.data as Hex }));
          if (step.requiresGuardian) {
            const a = approvals.get(plan.id, step.index);
            if (!a) {
              step.status = "awaiting_guardian";
              plans.save(plan);
              return { error: "Guardian signature missing. The user must approve this step on their Ledger first." };
            }
            txHash = await rt.wallet.send({
              chainId: chain.id, to: rt.account,
              data: encodeExecuteWithGuardian(calls, BigInt(step.maxUsdcOut), planIdHex, step.index, BigInt(a.deadline), a.signature),
            });
            approvals.delete(plan.id, step.index);
          } else {
            txHash = await rt.wallet.send({ chainId: chain.id, to: rt.account, data: encodeExecute(calls, planIdHex, step.index) });
          }
        }
        step.status = "done";
        step.txHash = txHash;
        step.explorer = explorerTx(chain, txHash);
        plans.save(plan);
        audit.write({ planId, step: idx, kind: "execute", chainId: chain.id, txHash, explorer: step.explorer, summary });
        const extra = step.kind === "supply_borrow" ? await readCometPosition(rt.basePub, rt.account).then((p) => ({ healthFactor: p.healthFactor.toFixed(2), liquidationPriceUsd: p.liquidationPriceUsd })) : {};
        return { ok: true, step: idx, title: step.title, txHash, explorer: step.explorer, summary, ...extra };
      } catch (e) {
        step.status = "failed";
        plans.save(plan);
        const msg = (e as Error).message;
        audit.write({ planId, step: idx, kind: "error", summary: msg });
        return { ok: false, step: idx, error: msg };
      }
    },
  }),

  check_repayments: tool({
    description: "List repayment intents recorded on the Arc account (due date, amount, done). Use to remind the user or to start a repayment plan.",
    inputSchema: z.object({}),
    execute: async () => {
      const rt = await getRuntime();
      const n = await rt.arcPub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "repaymentCount" });
      const items = [];
      for (let i = 0n; i < n; i++) {
        const [dueAt, amount, venue, done] = await rt.arcPub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "repayments", args: [i] });
        const dueMs = Number(dueAt) * 1000;
        items.push({ id: Number(i), dueAt: new Date(dueMs).toISOString(), amountUsdc: fmtUsdc(amount), venue, done, daysLeft: Math.round((dueMs - Date.now()) / 86_400_000), overdue: !done && dueMs < Date.now() });
      }
      const pos = await readCometPosition(rt.basePub, rt.account);
      return { repayments: items, currentDebtUsdc: fmtUsdc(pos.debtUsdc), healthFactor: Number.isFinite(pos.healthFactor) ? pos.healthFactor.toFixed(2) : "∞" };
    },
  }),

  draft_repayment_plan: tool({
    description: "Plan the reverse leg: bridge USDC back from Arc if needed, repay Compound v3 on Base Sepolia, withdraw freed collateral, close the repayment intent. Then simulate_plan and execute_step as usual.",
    inputSchema: z.object({ intent: RepayIntentSchema }),
    execute: async ({ intent }) => {
      const rt = await getRuntime();
      const arcBal = await usdcBalance(rt.arcPub, ARC_TESTNET.usdc, rt.account);
      const arcNative = await rt.arcPub.getBalance({ address: rt.account });
      const id = `repay-${Date.now().toString(36)}`;
      const plan = await buildRepaymentPlan({ id, intent, account: rt.account, baseSepolia: rt.basePub, arcUsdcBalance6: arcBal + arcNative / 1_000_000_000_000n });
      plans.save(plan);
      audit.write({ planId: id, step: 0, kind: "plan", summary: `Repayment plan drafted: ${plan.steps.map((s) => s.title).join(" → ")}` });
      return summarizePlan(plan);
    },
  }),

  get_plan: tool({
    description: "Fetch a plan and the status of each step.",
    inputSchema: z.object({ planId: z.string() }),
    execute: async ({ planId }) => {
      const plan = plans.get(planId);
      return plan ? summarizePlan(plan) : { error: `unknown plan ${planId}` };
    },
  }),

  get_audit: tool({
    description: "Read the audit trail (reasoning, transactions, approvals) for a plan or everything.",
    inputSchema: z.object({ planId: z.string().optional() }),
    execute: async ({ planId }) => ({ entries: audit.read(planId).slice(-40) }),
  }),
};

export function summarizePlan(plan: Plan) {
  return {
    planId: plan.id,
    venue: plan.venueId,
    venueExplanation: plan.venueExplanation,
    account: plan.account,
    collateralEth: Number(formatUnits(BigInt(plan.collateralWeth), 18)).toFixed(4),
    projected: plan.projected,
    steps: plan.steps.map((s: Step) => ({
      step: s.index, kind: s.kind, chainId: s.chainId, title: s.title, description: s.description,
      reversible: s.reversible, requiresGuardian: s.requiresGuardian, maxUsdcOut: fmtUsdc(BigInt(s.maxUsdcOut)),
      status: s.status, txHash: s.txHash, explorer: s.explorer, simulation: s.simulation,
    })),
  };
}
