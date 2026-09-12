import { createPublicClient, formatUnits, http, parseAbiItem, type Address, type Chain, type Hex, type PublicClient } from "viem";
import { MandateAccountAbi } from "./abi/MandateAccount.ts";
import { ARC_TESTNET, BASE_SEPOLIA, CCTP } from "./addresses.ts";
import { getAction } from "./actions/registry.ts";
import type { ActionContext, ActionRequest, ExecutionContext } from "./actions/types.ts";
import { approvalText, verifyGuardianSignature } from "./approval/message.ts";
import { chains as chainPresets, explorerTx } from "./chains.ts";
import { describeError } from "./errors.ts";
import { callsHash, encodeExecute, encodeExecuteWithGuardian, planIdToBytes32, type Call } from "./exec/account.ts";
import { waitForAttestation, type Attestation } from "./exec/cctp.ts";
import { readCometPosition } from "./exec/compound.ts";
import { usdcBalance } from "./exec/cctp.ts";
import type { GuardianSigner } from "./guardian/types.ts";
import { compoundTwinRate, fetchMarkets, fetchMorphoUsdcRates, rankVenues, type MarketsSnapshot, type Ranked } from "./markets/index.ts";
import type { Intent, Plan, RepayIntent, Step } from "./plan/schema.ts";
import { simulateStep, type StepSimulation } from "./sim/simulate.ts";
import { memoryStore } from "./store/memory.ts";
import type { PendingApproval, Store, StoredApproval } from "./store/types.ts";
import type { AgentWallet } from "./wallet/types.ts";

export interface ChainConfig { chain: Chain; rpc?: string }

export interface MandateConfig {
  /** Chains the account lives on. Defaults to Base Sepolia + Arc testnet presets. */
  chains?: Record<number, ChainConfig>;
  /** MandateAccount address (identical on every configured chain). */
  account: Address;
  /** The agent's signer. */
  wallet: AgentWallet;
  /** Optional co-signer. When present, guardian steps are signed automatically inside `execute`. */
  guardian?: GuardianSigner;
  store?: Store;
  graphApiKey?: string;
  /** Approval validity window in seconds (default 15 min). */
  approvalTtlSeconds?: number;
}

export type StepResult =
  | { ok: true; step: number; title: string; txHash?: Hex; explorer?: string; summary: string; alreadyDone?: boolean; note?: string; [k: string]: unknown }
  | { ok: false; step: number; error: string; awaitingGuardian?: boolean; approval?: PendingApproval };

export const isDone = (s: Step) => s.status === "done" || s.status === "skipped";
/** Plans are persisted as JSON: bigints become decimal strings. Adapters coerce with BigInt() when reading params. */
export const jsonSafe = <T,>(v: T): T => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
const fmtUsdc = (v: bigint) => Number(formatUnits(v, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * The Mandate client: plan → simulate → execute under an on-chain mandate, with guardian approvals.
 * Framework-agnostic; `@yashjain99/mandate-ai` wraps it for the Vercel AI SDK and MCP.
 */
export class MandateClient {
  readonly account: Address;
  readonly wallet: AgentWallet;
  readonly store: Store;
  readonly guardianSigner?: GuardianSigner;
  readonly graphApiKey?: string;
  private readonly pubs = new Map<number, PublicClient>();
  private readonly chainsCfg: Record<number, ChainConfig>;
  private readonly ttl: number;
  private ownerCache?: Address;
  private guardianChecked = false;

  constructor(cfg: MandateConfig) {
    this.account = cfg.account;
    this.wallet = cfg.wallet;
    this.store = cfg.store ?? memoryStore();
    this.guardianSigner = cfg.guardian;
    this.graphApiKey = cfg.graphApiKey;
    this.ttl = cfg.approvalTtlSeconds ?? 15 * 60;
    this.chainsCfg = cfg.chains ?? { [chainPresets.baseSepolia.id]: { chain: chainPresets.baseSepolia }, [chainPresets.arcTestnet.id]: { chain: chainPresets.arcTestnet } };
  }

  // ------------------------------------------------------------------ chain access
  chain(chainId: number): Chain {
    const c = this.chainsCfg[chainId];
    if (!c) throw new Error(`chain ${chainId} not configured`);
    return c.chain;
  }
  pub(chainId: number): PublicClient {
    let p = this.pubs.get(chainId);
    if (!p) { const c = this.chainsCfg[chainId]; if (!c) throw new Error(`chain ${chainId} not configured`); p = createPublicClient({ chain: c.chain, transport: http(c.rpc) }); this.pubs.set(chainId, p); }
    return p;
  }
  chainIds(): number[] { return Object.keys(this.chainsCfg).map(Number); }
  explorer(chainId: number, hash: Hex) { return explorerTx(this.chain(chainId), hash); }

  private ctx(): ActionContext {
    return {
      account: this.account,
      pub: (id) => this.pub(id),
      policyFor: async (chainId, target, selector) => {
        const p = await this.pub(chainId).readContract({ address: this.account, abi: MandateAccountAbi, functionName: "policyFor", args: [target, selector] });
        return { allowed: p.allowed, requiresGuardian: p.requiresGuardian };
      },
      now: () => Math.floor(Date.now() / 1000),
    };
  }

  // ------------------------------------------------------------------ account reads
  async owner(): Promise<Address> {
    this.ownerCache ??= await this.pub(this.chainIds()[0]!).readContract({ address: this.account, abi: MandateAccountAbi, functionName: "owner" });
    return this.ownerCache;
  }
  /** Live on-chain guardian. First call checks all configured chains agree and throws if they do not. */
  async guardian(chainId?: number): Promise<Address> {
    if (!this.guardianChecked) {
      const all = await Promise.all(this.chainIds().map((id) => this.pub(id).readContract({ address: this.account, abi: MandateAccountAbi, functionName: "guardian" })));
      if (new Set(all.map((a) => a.toLowerCase())).size > 1) throw new Error(`Guardian differs across chains (${this.chainIds().map((id, i) => `${id}: ${all[i]}`).join(", ")}). Run setGuardian on every chain with the same address.`);
      this.guardianChecked = true;
    }
    return this.pub(chainId ?? this.chainIds()[0]!).readContract({ address: this.account, abi: MandateAccountAbi, functionName: "guardian" });
  }
  async agentAddress(): Promise<Address> { return this.wallet.address(this.chainIds()[0]!); }

  async positions() {
    const base = this.pub(BASE_SEPOLIA.chainId), arc = this.pub(ARC_TESTNET.chainId);
    const [ethBase, usdcBase, usdcArc, nativeArc, pos, mandate, dailyRemaining, nonce, guardian, agent] = await Promise.all([
      base.getBalance({ address: this.account }), usdcBalance(base, BASE_SEPOLIA.usdc, this.account), usdcBalance(arc, ARC_TESTNET.usdc, this.account), arc.getBalance({ address: this.account }),
      readCometPosition(base, this.account),
      base.readContract({ address: this.account, abi: MandateAccountAbi, functionName: "mandate" }),
      base.readContract({ address: this.account, abi: MandateAccountAbi, functionName: "dailyRemaining" }),
      base.readContract({ address: this.account, abi: MandateAccountAbi, functionName: "guardianNonce" }),
      this.guardian(), this.agentAddress(),
    ]);
    const [perTxCap, dailyCap, expiry] = mandate;
    return {
      account: this.account, agent, agentWallet: this.wallet.kind, guardian,
      baseSepolia: { ethWei: ethBase.toString(), eth: Number(formatUnits(ethBase, 18)).toFixed(4), usdc: fmtUsdc(usdcBase) },
      arc: { usdcErc20: fmtUsdc(usdcArc), usdcNative: Number(formatUnits(nativeArc, 18)).toFixed(2) },
      compound: { debtUsdc: fmtUsdc(pos.debtUsdc), collateralWeth: Number(formatUnits(pos.collateralWeth, 18)).toFixed(4), wethPriceUsd: pos.wethPriceUsd, healthFactor: Number.isFinite(pos.healthFactor) ? pos.healthFactor.toFixed(2) : "∞", liquidationPriceUsd: pos.liquidationPriceUsd, borrowAprPct: pos.borrowAprPct.toFixed(2), liquidateCollateralFactor: pos.liquidateCollateralFactor },
      mandate: { perTxCapUsdc: fmtUsdc(perTxCap), dailyCapUsdc: fmtUsdc(dailyCap), dailyRemainingUsdc: fmtUsdc(dailyRemaining), expiresAt: expiry === 0n ? null : new Date(Number(expiry) * 1000).toISOString(), active: expiry !== 0n && Number(expiry) * 1000 > Date.now(), guardianNonce: nonce.toString() },
    };
  }

  async repayments() {
    const arc = this.pub(ARC_TESTNET.chainId);
    const n = await arc.readContract({ address: this.account, abi: MandateAccountAbi, functionName: "repaymentCount" });
    const items = [];
    for (let i = 0n; i < n; i++) {
      const [dueAt, amount, venue, done] = await arc.readContract({ address: this.account, abi: MandateAccountAbi, functionName: "repayments", args: [i] });
      const dueMs = Number(dueAt) * 1000;
      items.push({ id: Number(i), dueAt: new Date(dueMs).toISOString(), amountUsdc: fmtUsdc(amount), amountUsdc6: amount, venue, done, daysLeft: Math.round((dueMs - Date.now()) / 86_400_000), overdue: !done && dueMs < Date.now() });
    }
    const pos = await readCometPosition(this.pub(BASE_SEPOLIA.chainId), this.account);
    return { repayments: items, currentDebtUsdc: fmtUsdc(pos.debtUsdc), currentDebtUsdc6: pos.debtUsdc, healthFactor: Number.isFinite(pos.healthFactor) ? pos.healthFactor.toFixed(2) : "∞" };
  }

  // ------------------------------------------------------------------ markets
  async markets(amountUsdc: number): Promise<{ snapshot: MarketsSnapshot; ranked: Ranked }> {
    const base = this.pub(BASE_SEPOLIA.chainId);
    let snapshot: MarketsSnapshot;
    if (this.graphApiKey) snapshot = await fetchMarkets({ graphApiKey: this.graphApiKey, baseSepoliaClient: base });
    else {
      snapshot = { fetchedAt: new Date().toISOString(), rates: [], warnings: ["GRAPH_API_KEY not set — standardized subgraphs skipped"] };
      try { snapshot.rates.push(...(await fetchMorphoUsdcRates())); } catch (e) { snapshot.warnings.push(describeError(e)); }
      try { snapshot.rates.push(await compoundTwinRate(base)); } catch (e) { snapshot.warnings.push(describeError(e)); }
    }
    return { snapshot, ranked: rankVenues(snapshot, amountUsdc) };
  }

  // ------------------------------------------------------------------ planning
  /** Generic planner: an ordered list of action requests becomes a typed, policy-aware plan. */
  async plan(requests: ActionRequest[], opts: { id?: string; intent: Intent | RepayIntent; venueId?: string; venueExplanation?: string }): Promise<Plan> {
    const ctx = this.ctx();
    const steps: Step[] = [];
    const projected: Plan["projected"] = { healthFactor: Number.POSITIVE_INFINITY, liquidationPriceUsd: null, borrowAprPct: 0, wethPriceUsd: 0 };
    let collateralWeth = 0n;
    for (const [i, req] of requests.entries()) {
      const adapter = getAction(req.kind);
      const chainId = adapter.chainId(req.params, ctx);
      const built = await adapter.build(req.params, ctx);
      let requiresGuardian = adapter.guardianRule === "always";
      if (adapter.guardianRule === "policy") {
        for (const c of built.calls) {
          const p = await ctx.policyFor(chainId, c.target, (c.data.length >= 10 ? c.data.slice(0, 10) : "0x00000000") as Hex);
          if (!p.allowed) throw new Error(`policy: ${c.target} ${c.data.slice(0, 10)} is not allow-listed on chain ${chainId}`);
          if (p.requiresGuardian) requiresGuardian = true;
        }
      }
      if (built.projection) {
        const { collateralWeth: cw, ...proj } = built.projection;
        Object.assign(projected, proj);
        if (cw !== undefined) collateralWeth = cw;
      }
      steps.push({
        index: i + 1, kind: req.kind, chainId, title: built.title, description: built.description,
        reversible: adapter.reversible, requiresGuardian, maxUsdcOut: built.maxUsdcOut.toString(),
        calls: built.calls.map((c) => ({ target: c.target, value: c.value.toString(), data: c.data })),
        direct: built.direct, status: "pending", params: jsonSafe(req.params) as Record<string, unknown>,
      });
    }
    const plan: Plan = {
      id: opts.id ?? `plan-${Date.now().toString(36)}`, createdAt: new Date().toISOString(), intent: opts.intent,
      venueId: opts.venueId ?? "compound-v3-base-sepolia", venueExplanation: opts.venueExplanation ?? "", account: this.account,
      collateralWeth: collateralWeth.toString(), projected: { ...projected, healthFactor: Number.isFinite(projected.healthFactor) ? projected.healthFactor : 1e9 }, steps,
    };
    await this.store.plans.save(plan);
    await this.store.audit.write({ planId: plan.id, step: 0, kind: "plan", summary: `Plan drafted: ${steps.map((s) => s.title).join(" → ")}`, data: { venue: plan.venueId } });
    return plan;
  }

  // ------------------------------------------------------------------ simulation
  async simulate(plan: Plan) {
    const owner = await this.owner();
    const agent = await this.agentAddress();
    const results: Array<{ step: number; title: string; ok: boolean; deferred?: boolean; revertReason?: string; notes: string[] }> = [];
    let priorDone = true;
    for (const step of plan.steps) {
      if (step.status === "executing" && (await this.isExecutedOnChain(plan, step))) this.markDone(plan, step, step.txHash as Hex | undefined);
      if (isDone(step)) { results.push({ step: step.index, title: step.title, ok: true, notes: ["already executed"] }); continue; }
      if (step.calls.length === 0 && !step.params) { results.push({ step: step.index, title: step.title, ok: false, revertReason: "plan predates the current SDK; draft it again", notes: [] }); step.status = "failed"; priorDone = false; continue; }
      const sim = await simulateStep(this.pub(step.chainId), step, { account: this.account, agent, owner, planId: planIdToBytes32(plan.id), priorStepsDone: priorDone });
      step.simulation = sim;
      if (step.status !== "awaiting_guardian") step.status = sim.ok ? "simulated" : "failed";
      results.push({ step: step.index, title: step.title, ok: sim.ok, deferred: sim.deferred ?? false, revertReason: sim.revertReason, notes: sim.notes });
      priorDone = false;
    }
    await this.store.plans.save(plan);
    const verified = results.filter((r) => r.ok && !r.deferred && r.notes[0] !== "already executed").length;
    const deferred = results.filter((r) => r.deferred).length;
    const failed = results.filter((r) => !r.ok).length;
    await this.store.audit.write({ planId: plan.id, step: 0, kind: "simulate", summary: `Simulation: ${verified} verified, ${deferred} checked statically (depend on earlier steps), ${failed} failing` });
    return { planId: plan.id, results, verified, deferred, failed, note: deferred > 0 ? "Deferred steps passed only the allow-list check; execute re-simulates each step against live state right before running it." : undefined };
  }

  // ------------------------------------------------------------------ approvals
  readonly approvals = {
    request: async (plan: Plan, step: Step): Promise<PendingApproval> => {
      const pub = this.pub(step.chainId);
      const [nonce, guardian] = await Promise.all([pub.readContract({ address: this.account, abi: MandateAccountAbi, functionName: "guardianNonce" }), this.guardian(step.chainId)]);
      const now = Math.floor(Date.now() / 1000);
      const cached = await this.store.approvals.getPending(plan.id, step.index);
      if (cached && cached.nonce === nonce.toString() && cached.guardian.toLowerCase() === guardian.toLowerCase() && Number(cached.deadline) - now > 60) return cached;
      const deadline = BigInt(now + this.ttl);
      const calls = this.calls(step);
      const fields = { account: this.account, chainId: step.chainId, planId: planIdToBytes32(plan.id), step: step.index, maxUsdcOut: BigInt(step.maxUsdcOut), callsHash: callsHash(calls), deadline, nonce };
      const text = approvalText(fields);
      const onchain = await pub.readContract({ address: this.account, abi: MandateAccountAbi, functionName: "approvalText", args: [fields.planId, fields.step, fields.maxUsdcOut, fields.callsHash, fields.deadline, fields.nonce] });
      if (onchain !== text) throw new Error("approval text mismatch between SDK and contract");
      const pending: PendingApproval = { planId: plan.id, step: step.index, chainId: step.chainId, guardian, text, deadline: deadline.toString(), nonce: nonce.toString(), builtAt: new Date().toISOString() };
      await this.store.approvals.putPending(pending);
      await this.store.audit.write({ planId: plan.id, step: step.index, kind: "guardian-request", chainId: step.chainId, summary: `Guardian approval requested: ${step.title}`, data: { text, nonce: pending.nonce, deadline: pending.deadline } });
      return pending;
    },
    submit: async (plan: Plan, step: Step, signature: Hex, via = "sdk"): Promise<StoredApproval> => {
      const pending = (await this.store.approvals.getPending(plan.id, step.index)) ?? (await this.approvals.request(plan, step));
      const guardian = await this.guardian(step.chainId);
      if (guardian.toLowerCase() !== pending.guardian.toLowerCase()) { await this.store.approvals.delete(plan.id, step.index); throw new Error("guardian changed on-chain since the approval was built; request it again"); }
      if (Number(pending.deadline) <= Math.floor(Date.now() / 1000)) { await this.store.approvals.delete(plan.id, step.index); throw new Error("approval expired; request it again"); }
      if (!(await verifyGuardianSignature(guardian, pending.text, signature))) throw new Error("signature does not recover to the on-chain guardian");
      const stored: StoredApproval = { ...pending, signature, signedAt: new Date().toISOString() };
      await this.store.approvals.put(stored);
      step.status = "awaiting_guardian";
      await this.store.plans.save(plan);
      await this.store.audit.write({ planId: plan.id, step: step.index, kind: "guardian-approved", chainId: step.chainId, summary: `Guardian ${guardian} signed step ${step.index} (${via})` });
      return stored;
    },
    /** Request + sign with the configured GuardianSigner + submit. */
    signWith: async (signer: GuardianSigner, plan: Plan, step: Step, onStatus?: (s: string) => void): Promise<StoredApproval> => {
      const pending = await this.approvals.request(plan, step);
      const addr = await signer.address();
      if (addr.toLowerCase() !== pending.guardian.toLowerCase()) throw new Error(`signer ${addr} is not the on-chain guardian ${pending.guardian}`);
      const sig = await signer.signMessage(pending.text, onStatus);
      return this.approvals.submit(plan, step, sig, signer.kind);
    },
  };

  // ------------------------------------------------------------------ execution
  private calls(step: Step): Call[] { return step.calls.map((c) => ({ target: c.target as Address, value: BigInt(c.value), data: c.data as Hex })); }
  private markDone(plan: Plan, step: Step, txHash?: Hex) { step.status = "done"; if (txHash) { step.txHash = txHash; step.explorer = this.explorer(step.chainId, txHash); } }

  /**
   * Recovers the tx hash of an already-executed call-step from the account's StepExecuted logs (bounded lookback).
   * Used when a send was broadcast but the receipt never came back to us.
   */
  async findStepTxHash(plan: Plan, step: Step, lookbackBlocks = 200_000n): Promise<Hex | undefined> {
    const pub = this.pub(step.chainId);
    const latest = await pub.getBlockNumber();
    const event = parseAbiItem("event StepExecuted(bytes32 indexed planId, uint8 indexed step, uint256 usdcOut, bytes32 callsHash, bool guarded)");
    const chunk = 9_000n;
    for (let to = latest; to > 0n && latest - to < lookbackBlocks; to -= chunk) {
      const from = to > chunk ? to - chunk + 1n : 0n;
      try {
        const logs = await pub.getLogs({ address: this.account, event, args: { planId: planIdToBytes32(plan.id), step: step.index }, fromBlock: from, toBlock: to });
        if (logs.length) return logs[logs.length - 1]!.transactionHash;
      } catch { /* provider range limits: keep walking back */ }
    }
    return undefined;
  }

  private async isExecutedOnChain(plan: Plan, step: Step, attestation?: Attestation): Promise<boolean> {
    if (step.calls.length > 0) return this.pub(step.chainId).readContract({ address: this.account, abi: MandateAccountAbi, functionName: "executed", args: [planIdToBytes32(plan.id), step.index] });
    const adapter = getAction(step.kind);
    if (!adapter.isExecuted) return false;
    return adapter.isExecuted(step.params ?? {}, { ...this.ctx(), plan, step, attestation });
  }

  /** Execute one step. Idempotent and crash-safe: the chain is consulted before anything is sent. */
  async execute(plan: Plan, index: number): Promise<StepResult> {
    const step = plan.steps.find((s) => s.index === index);
    if (!step) return { ok: false, step: index, error: `plan ${plan.id} has no step ${index}` };
    const prev = plan.steps.find((s) => s.index === index - 1);
    if (prev && !isDone(prev)) return { ok: false, step: index, error: `step ${index - 1} must complete first (status: ${prev.status})` };
    if (isDone(step)) return { ok: true, step: index, title: step.title, summary: step.title, txHash: step.txHash as Hex | undefined, explorer: step.explorer, alreadyDone: true };

    const chainId = step.chainId, pub = this.pub(chainId), planIdHex = planIdToBytes32(plan.id);
    if (step.calls.length === 0 && !step.params) {
      return { ok: false, step: index, error: "this plan predates the current SDK (no step params); draft it again" };
    }
    const adapter = getAction(step.kind);
    const exeCtx: ExecutionContext = { ...this.ctx(), plan, step };
    let approval: StoredApproval | null = null;

    // ---- pre-flight (never throws out: every failure is a structured result) -----------------------------
    try {
      if (step.kind === "bridge_relay") {
        const burn = plan.steps.find((s) => s.kind === "bridge_burn" && s.index < step.index);
        if (!burn) return { ok: false, step: index, error: "bridge burn step missing" };
        if (!burn.txHash) {
          const recovered = await this.findStepTxHash(plan, burn); // burn landed but we lost the receipt
          if (!recovered) return { ok: false, step: index, error: "bridge burn tx hash unknown; could not recover it from chain logs" };
          burn.txHash = recovered; burn.explorer = this.explorer(burn.chainId, recovered); await this.store.plans.save(plan);
        }
        const srcDomain = burn.chainId === BASE_SEPOLIA.chainId ? BASE_SEPOLIA.domain : ARC_TESTNET.domain;
        exeCtx.attestation = await waitForAttestation(srcDomain, burn.txHash as Hex, { timeoutMs: 4 * 60_000 });
      }

      if (await this.isExecutedOnChain(plan, step, exeCtx.attestation)) {
        const hash = (step.txHash as Hex | undefined) ?? (step.calls.length > 0 ? await this.findStepTxHash(plan, step) : undefined);
        this.markDone(plan, step, hash); await this.store.plans.save(plan);
        await this.store.audit.write({ planId: plan.id, step: index, kind: "info", chainId, summary: `Step ${index} was already executed on-chain; marked done without re-sending` });
        return { ok: true, step: index, title: step.title, summary: step.title, txHash: hash, explorer: step.explorer, alreadyDone: true };
      }

      if (step.calls.length > 0) {
        const sim: StepSimulation = await simulateStep(pub, step, { account: this.account, agent: await this.agentAddress(), owner: await this.owner(), planId: planIdHex, priorStepsDone: true });
        step.simulation = sim;
        if (!sim.ok) { step.status = "failed"; await this.store.plans.save(plan); await this.store.audit.write({ planId: plan.id, step: index, kind: "error", chainId, summary: `Pre-flight simulation failed: ${sim.revertReason}` }); return { ok: false, step: index, error: `simulation failed: ${sim.revertReason}` }; }
      }

      if (step.requiresGuardian) {
        approval = await this.store.approvals.get(plan.id, step.index);
        if (approval) {
          const liveNonce = await pub.readContract({ address: this.account, abi: MandateAccountAbi, functionName: "guardianNonce" });
          if (approval.nonce !== liveNonce.toString() || Number(approval.deadline) <= Math.floor(Date.now() / 1000) + 30) {
            await this.store.approvals.delete(plan.id, step.index); approval = null;
            await this.store.audit.write({ planId: plan.id, step: index, kind: "info", chainId, summary: "Stored guardian approval was stale (nonce moved or deadline passed); a fresh approval is required" });
          }
        }
        if (!approval && this.guardianSigner) approval = await this.approvals.signWith(this.guardianSigner, plan, step);
        if (!approval) {
          const pending = await this.approvals.request(plan, step);
          step.status = "awaiting_guardian"; await this.store.plans.save(plan);
          return { ok: false, step: index, awaitingGuardian: true, approval: pending, error: "Guardian signature missing or stale. The guardian must sign the approval text first." };
        }
      }
    } catch (e) {
      const msg = describeError(e);
      await this.store.audit.write({ planId: plan.id, step: index, kind: "error", chainId, summary: `pre-flight: ${msg}` });
      return { ok: false, step: index, error: msg };
    }

    step.status = "executing"; await this.store.plans.save(plan);
    let txHash: Hex;
    try {
      if (step.calls.length === 0) {
        const direct = adapter.resolveDirect ? await adapter.resolveDirect(step.params ?? {}, exeCtx) : step.direct;
        if (!direct || direct.data === "0x") throw new Error(`step ${index}: no calldata`);
        txHash = await this.wallet.send({ chainId, to: direct.to as Address, data: direct.data as Hex });
      } else {
        const calls = this.calls(step);
        txHash = approval
          ? await this.wallet.send({ chainId, to: this.account, data: encodeExecuteWithGuardian(calls, BigInt(step.maxUsdcOut), planIdHex, step.index, BigInt(approval.deadline), approval.signature) })
          : await this.wallet.send({ chainId, to: this.account, data: encodeExecute(calls, planIdHex, step.index) });
        if (approval) await this.store.approvals.delete(plan.id, step.index);
      }
    } catch (e) {
      const msg = describeError(e);
      if (await this.isExecutedOnChain(plan, step, exeCtx.attestation)) {
        const hash = step.calls.length > 0 ? await this.findStepTxHash(plan, step) : undefined; // keep the hash: later steps (relay) need it
        this.markDone(plan, step, hash); await this.store.plans.save(plan);
        return { ok: true, step: index, title: step.title, summary: step.title, txHash: hash, explorer: step.explorer, alreadyDone: true, note: "a previous attempt had already executed this step" };
      }
      if (approval && /BadGuardianSignature|ApprovalExpired/.test(msg)) await this.store.approvals.delete(plan.id, step.index);
      step.status = "failed"; await this.store.plans.save(plan);
      await this.store.audit.write({ planId: plan.id, step: index, kind: "error", chainId, summary: msg });
      return { ok: false, step: index, error: msg };
    }

    // success: persist first; enrichment can only add notes
    this.markDone(plan, step, txHash); await this.store.plans.save(plan);
    let summary = step.title;
    const extra: Record<string, unknown> = {};
    try {
      if (adapter.afterExecute) {
        const receipt = await pub.getTransactionReceipt({ hash: txHash });
        Object.assign(extra, await adapter.afterExecute(step.params ?? {}, receipt, exeCtx));
        if (typeof extra.mintedUsdc === "string") summary = Number(extra.mintedUsdc) > 0 ? `Minted ${extra.mintedUsdc} USDC on ${this.chain(chainId).name}` : `receiveMessage confirmed on ${this.chain(chainId).name}`;
      }
    } catch (e) { extra.note = `executed; post-execution read failed: ${describeError(e)}`; }
    try { await this.store.audit.write({ planId: plan.id, step: index, kind: "execute", chainId, txHash, explorer: step.explorer, summary, data: extra }); } catch { /* never fail a landed step on logging */ }
    return { ok: true, step: index, title: step.title, txHash, explorer: step.explorer, summary, ...extra };
  }

  /** Execute every remaining step in order; stops at the first failure or guardian pause. */
  async executeAll(plan: Plan, onStep?: (r: StepResult) => void): Promise<StepResult[]> {
    const out: StepResult[] = [];
    for (const s of plan.steps) {
      if (isDone(s)) continue;
      const r = await this.execute(plan, s.index);
      out.push(r); onStep?.(r);
      if (!r.ok) break;
    }
    return out;
  }
}

export function createMandate(cfg: MandateConfig): MandateClient { return new MandateClient(cfg); }
export { CCTP };
