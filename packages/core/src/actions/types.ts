import type { Address, Hex, PublicClient, TransactionReceipt } from "viem";
import type { Plan, Step, StepKind } from "../plan/schema.ts";
import type { Call } from "../exec/account.ts";
import type { Attestation } from "../exec/cctp.ts";

export interface ActionContext {
  account: Address;
  pub(chainId: number): PublicClient;
  /** Live on-chain policy lookup (specific entry, else wildcard). */
  policyFor(chainId: number, target: Address, selector: Hex): Promise<{ allowed: boolean; requiresGuardian: boolean }>;
  now(): number; // unix seconds
}

export interface BuildResult {
  title: string;
  description: string;
  /** Calls routed through MandateAccount.execute / executeWithGuardian. Empty for direct agent transactions. */
  calls: Call[];
  /** Binding maximum USDC (6-dec) that may leave the account in this step; "0" for inflows. */
  maxUsdcOut: bigint;
  /** Transaction the agent wallet sends directly (not through the account). `data: "0x"` = resolved at execution. */
  direct?: { to: Address; data: Hex };
  /** Optional numbers surfaced on the plan (health factor etc.). */
  projection?: Partial<Plan["projected"]> & { collateralWeth?: bigint };
}

export interface ExecutionContext extends ActionContext {
  plan: Plan;
  step: Step;
  /** For CCTP relays: the attestation fetched by the executor before the idempotency probe. */
  attestation?: Attestation;
}

/**
 * A protocol integration. Implement one to let Mandate agents use your protocol under a mandate.
 * `guardianRule: "policy"` defers to the account's on-chain allow-list (recommended); "always"/"never" are explicit.
 */
export interface ActionAdapter<P = any> {
  kind: StepKind;
  chainId(params: P, ctx: ActionContext): number;
  reversible: boolean;
  guardianRule: "never" | "always" | "policy";
  build(params: P, ctx: ActionContext): Promise<BuildResult>;
  /** On-chain probe: has this step already taken effect? Default for call-steps is the account's per-step `executed` flag. */
  isExecuted?(params: P, ctx: ExecutionContext): Promise<boolean>;
  /** Resolve `direct.data` at execution time (e.g. CCTP receiveMessage needs the attestation). */
  resolveDirect?(params: P, ctx: ExecutionContext): Promise<{ to: Address; data: Hex }>;
  /** Post-execution enrichment (health factor, minted amount). Must never throw fatally — errors are reported as notes. */
  afterExecute?(params: P, receipt: TransactionReceipt, ctx: ExecutionContext): Promise<Record<string, unknown>>;
}

export interface ActionRequest<P = any> { kind: StepKind; params: P }
