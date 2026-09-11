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
  isMessageReceived,
  usdcCreditedInReceipt,
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
import { getRuntime, type Runtime } from "./runtime.ts";
import { approvals, audit, plans } from "./store.ts";

const fmtUsdc = (v: bigint) => Number(formatUnits(v, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Single definition of "this step no longer needs to run". */
export const isDone = (s: Step) => s.status === "done" || s.status === "skipped";

/**
 * Asks the chain whether a step has already taken effect, so a retry after a crash never re-sends.
 *  - mandate steps: the account's per-(plan, step) `executed` flag
 *  - CCTP relay:    the destination transmitter's usedNonces for the attested message
 *  - schedule / mark_repaid: the repayment list on the Arc account
 */
async function alreadyExecutedOnChain(rt: Runtime, plan: Plan, step: Step, attestationMessage?: Hex): Promise<boolean> {
  const pub = step.chainId === 84532 ? rt.basePub : rt.arcPub;
  if (step.calls.length > 0) {
    return pub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "executed", args: [planIdToBytes32(plan.id), step.index] });
  }
  if (step.kind === "bridge_relay") return attestationMessage ? isMessageReceived(pub, attestationMessage) : false;
  if (step.kind === "mark_repaid" && plan.intent.kind === "repay" && plan.intent.repaymentId !== undefined) {
    const [, , , done] = await rt.arcPub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "repayments", args: [BigInt(plan.intent.repaymentId)] });
    return done;
  }
  if (step.kind === "schedule_repayment" && plan.intent.kind === "liquidity") {
    // a matching intent created after the plan was drafted counts as done
    const n = await rt.arcPub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "repaymentCount" });
    const amount = BigInt(Math.round(plan.intent.amountUsdc * 1e6));
    const earliest = Math.floor(new Date(plan.createdAt).getTime() / 1000) + plan.intent.repayInDays * 86400 - 3600;
    for (let i = n; i > 0n; i--) {
      const [dueAt, amt] = await rt.arcPub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "repayments", args: [i - 1n] });
      if (amt === amount && Number(dueAt) >= earliest) return true;
      if (Number(dueAt) < earliest) break;
    }
  }
  return false;
}

function markDone(plan: Plan, step: Step, txHash: Hex | undefined, chainId: number, summary: string) {
  step.status = "done";
  if (txHash) { step.txHash = txHash; step.explorer = explorerTx(chainId === 84532 ? chains.baseSepolia : chains.arcTestnet, txHash); }
  plans.save(plan);
}

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
        // a step stuck in `executing` after a crash: ask the chain, never guess
        if (step.status === "executing" && (await alreadyExecutedOnChain(rt, plan, step))) markDone(plan, step, step.txHash as Hex | undefined, step.chainId, step.title);
        if (isDone(step)) { results.push({ step: step.index, title: step.title, ok: true, notes: ["already executed"] }); continue; }
        const pub = step.chainId === 84532 ? rt.basePub : rt.arcPub;
        const sim = await simulateStep(pub, step, { account: rt.account, agent: rt.agent, owner: rt.base.owner, planId: planIdToBytes32(plan.id), priorStepsDone: priorDone });
        step.simulation = sim;
        if (step.status !== "awaiting_guardian") step.status = sim.ok ? "simulated" : "failed";
        results.push({ step: step.index, title: step.title, ok: sim.ok, deferred: sim.deferred ?? false, revertReason: sim.revertReason, notes: sim.notes });
        priorDone = false; // only the first not-yet-executed step can be simulated against real state
      }
      plans.save(plan);
      const dynamicOk = results.filter((r) => r.ok && !("deferred" in r && r.deferred)).length;
      const deferred = results.filter((r) => "deferred" in r && r.deferred).length;
      const failed = results.filter((r) => !r.ok).length;
      audit.write({ planId, step: 0, kind: "simulate", summary: `Simulation: ${dynamicOk} verified, ${deferred} checked statically (depend on earlier steps), ${failed} failing` });
      return {
        planId, results, verified: dynamicOk, deferred, failed,
        note: deferred > 0 ? "Deferred steps passed only the allow-list check; execute_step re-simulates each step against live state right before running it." : undefined,
      };
    },
  }),

  execute_step: tool({
    description:
      "Execute one plan step in order. Re-simulates the step against live state first. Steps flagged requiresGuardian pause for the user's Ledger approval; the signature is attached automatically once the user has signed. Safe to retry: the chain is checked before anything is re-sent. Returns the transaction hash and explorer link.",
    inputSchema: z.object({ planId: z.string(), step: z.number().int().min(1) }),
    execute: async ({ planId, step: idx }) => {
      const rt = await getRuntime();
      const plan = plans.get(planId);
      if (!plan) return { error: `unknown plan ${planId}` };
      const step = plan.steps.find((s) => s.index === idx);
      if (!step) return { error: `plan ${planId} has no step ${idx}` };
      const prev = plan.steps.find((s) => s.index === idx - 1);
      if (prev && !isDone(prev)) return { error: `step ${idx - 1} must complete first (status: ${prev.status})` };
      if (isDone(step)) return { ok: true, alreadyDone: true, step: idx, txHash: step.txHash, explorer: step.explorer };

      const chain = step.chainId === 84532 ? chains.baseSepolia : chains.arcTestnet;
      const pub = step.chainId === 84532 ? rt.basePub : rt.arcPub;
      const planIdHex = planIdToBytes32(plan.id);

      // ---- idempotency: did a previous attempt already land? -------------------------------------------------
      let attestation: Awaited<ReturnType<typeof waitForAttestation>> | undefined;
      if (step.kind === "bridge_relay") {
        const burn = plan.steps.find((s) => s.kind === "bridge_burn" && s.index < step.index);
        if (!burn?.txHash) return { ok: false, step: idx, error: "bridge burn tx missing" };
        const srcDomain = burn.chainId === 84532 ? BASE_SEPOLIA.domain : ARC_TESTNET.domain;
        attestation = await waitForAttestation(srcDomain, burn.txHash as Hex, { timeoutMs: 4 * 60_000 });
      }
      if (await alreadyExecutedOnChain(rt, plan, step, attestation?.message)) {
        markDone(plan, step, step.txHash as Hex | undefined, chain.id, step.title);
        audit.write({ planId, step: idx, kind: "info", chainId: chain.id, summary: `Step ${idx} was already executed on-chain; marked done without re-sending` });
        return { ok: true, alreadyDone: true, step: idx, txHash: step.txHash, explorer: step.explorer };
      }

      // ---- re-simulate against live state (deferred simulations are only static) ---------------------------------
      if (step.calls.length > 0) {
        const sim = await simulateStep(pub, step, { account: rt.account, agent: rt.agent, owner: rt.base.owner, planId: planIdHex, priorStepsDone: true });
        step.simulation = sim;
        if (!sim.ok) { step.status = "failed"; plans.save(plan); audit.write({ planId, step: idx, kind: "error", chainId: chain.id, summary: `Pre-flight simulation failed: ${sim.revertReason}` }); return { ok: false, step: idx, error: `simulation failed: ${sim.revertReason}` }; }
      }

      // ---- guardian signature (fresh, for this nonce) --------------------------------------------------------------
      let approval = step.requiresGuardian ? approvals.get(plan.id, step.index) : null;
      if (step.requiresGuardian) {
        if (approval) {
          const liveNonce = await pub.readContract({ address: rt.account, abi: MandateAccountAbi, functionName: "guardianNonce" });
          const stale = approval.nonce !== liveNonce.toString() || Number(approval.deadline) <= Math.floor(Date.now() / 1000) + 30;
          if (stale) { approvals.delete(plan.id, step.index); approval = null; audit.write({ planId, step: idx, kind: "info", chainId: chain.id, summary: "Stored guardian approval was stale (nonce moved or deadline passed); a fresh approval is required" }); }
        }
        if (!approval) { step.status = "awaiting_guardian"; plans.save(plan); return { ok: false, step: idx, awaitingGuardian: true, error: "Guardian signature missing or stale. The user must approve this step on their Ledger first." }; }
      }

      // ---- send ----------------------------------------------------------------------------------------------------
      step.status = "executing";
      plans.save(plan);
      let txHash: Hex;
      let summary = step.title;
      try {
        if (step.kind === "bridge_relay") {
          txHash = await rt.wallet.send({ chainId: chain.id, to: CCTP.messageTransmitterV2, data: encodeReceiveMessage(attestation!) });
        } else if (step.kind === "mark_repaid") {
          if (!step.direct) throw new Error("mark_repaid step missing calldata");
          txHash = await rt.wallet.send({ chainId: chain.id, to: step.direct.to as Address, data: step.direct.data as Hex });
        } else if (step.kind === "schedule_repayment") {
          if (plan.intent.kind !== "liquidity") throw new Error("schedule_repayment only applies to liquidity plans");
          const dueAt = BigInt(Math.floor(Date.now() / 1000) + plan.intent.repayInDays * 86400);
          const amount = BigInt(Math.round(plan.intent.amountUsdc * 1e6));
          txHash = await rt.wallet.send({ chainId: chain.id, to: rt.account, data: encodeScheduleRepayment(dueAt, amount, BASE_SEPOLIA.comet) });
          summary = `Repayment of ${plan.intent.amountUsdc} USDC scheduled for ${new Date(Number(dueAt) * 1000).toDateString()}`;
        } else {
          const calls = step.calls.map((c) => ({ target: c.target as Address, value: BigInt(c.value), data: c.data as Hex }));
          txHash = approval
            ? await rt.wallet.send({ chainId: chain.id, to: rt.account, data: encodeExecuteWithGuardian(calls, BigInt(step.maxUsdcOut), planIdHex, step.index, BigInt(approval.deadline), approval.signature) })
            : await rt.wallet.send({ chainId: chain.id, to: rt.account, data: encodeExecute(calls, planIdHex, step.index) });
          if (approval) approvals.delete(plan.id, step.index);
        }
      } catch (e) {
        const msg = (e as Error).message;
        // the send failed — but did an earlier attempt land in the meantime? ask the chain before reporting failure
        if (await alreadyExecutedOnChain(rt, plan, step, attestation?.message)) {
          markDone(plan, step, undefined, chain.id, step.title);
          return { ok: true, alreadyDone: true, step: idx, note: "a previous attempt had already executed this step" };
        }
        if (approval && /BadGuardianSignature|ApprovalExpired/.test(msg)) approvals.delete(plan.id, step.index);
        step.status = "failed";
        plans.save(plan);
        audit.write({ planId, step: idx, kind: "error", chainId: chain.id, summary: msg });
        return { ok: false, step: idx, error: msg };
      }

      // ---- success: persist first, then best-effort enrichment that can never flip the status ----------------------
      markDone(plan, step, txHash, chain.id, summary);
      const extra: Record<string, unknown> = {};
      try {
        if (step.kind === "bridge_relay") {
          const receipt = await pub.getTransactionReceipt({ hash: txHash });
          const minted = usdcCreditedInReceipt(receipt, rt.account, step.chainId === 84532 ? BASE_SEPOLIA.usdc : ARC_TESTNET.usdc);
          summary = minted > 0n ? `Minted ${fmtUsdc(minted)} USDC on ${chain.name}` : `receiveMessage confirmed on ${chain.name} (mint amount not visible in logs)`;
        }
        if (step.kind === "supply_borrow" || step.kind === "repay") {
          const p = await readCometPosition(rt.basePub, rt.account);
          extra.healthFactor = Number.isFinite(p.healthFactor) ? p.healthFactor.toFixed(2) : "∞";
          extra.liquidationPriceUsd = p.liquidationPriceUsd;
          extra.debtUsdc = fmtUsdc(p.debtUsdc);
        }
      } catch (e) {
        extra.note = `executed; post-execution read failed: ${(e as Error).message}`;
      }
      try { audit.write({ planId, step: idx, kind: "execute", chainId: chain.id, txHash, explorer: step.explorer, summary, data: extra }); } catch { /* never fail a landed step on logging */ }
      return { ok: true, step: idx, title: step.title, txHash, explorer: step.explorer, summary, ...extra };
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
