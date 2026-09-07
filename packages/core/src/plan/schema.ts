import { z } from "zod";

/** What the LLM extracts from the user's message. Everything after this is deterministic code. */
export const IntentSchema = z.object({
  kind: z.literal("liquidity"),
  amountUsdc: z.number().positive().describe("USDC the user needs at the destination"),
  destinationChainId: z.literal(5042002).default(5042002).describe("Arc testnet"),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("payee on the destination chain, if the user wants to pay someone"),
  deadline: z.string().optional().describe("ISO date the funds are needed by"),
  constraints: z.object({
    doNotSell: z.array(z.string()).default([]).describe("assets the user refuses to sell, e.g. ['ETH']"),
    maxBorrowAprPct: z.number().optional(),
  }).default({ doNotSell: [] }),
  repayInDays: z.number().int().positive().default(7),
});
export type Intent = z.infer<typeof IntentSchema>;

export const StepKind = z.enum(["supply_borrow", "bridge_burn", "bridge_relay", "pay", "schedule_repayment", "repay", "mark_repaid"]);
export type StepKind = z.infer<typeof StepKind>;

export const CallSchema = z.object({ target: z.string(), value: z.string(), data: z.string() });

export const StepSchema = z.object({
  index: z.number().int().min(1),
  kind: StepKind,
  chainId: z.number().int(),
  title: z.string(),
  description: z.string(),
  /** Can this be undone by a later action without loss (e.g. withdraw collateral) or is value leaving for good? */
  reversible: z.boolean(),
  /** Derived from the on-chain policy + caps: true means a Ledger tap is needed. */
  requiresGuardian: z.boolean(),
  /** USDC (6-dec, as string) that may leave the account in this step; 0 for inflows. */
  maxUsdcOut: z.string(),
  /** Mandate calls; empty for steps the agent wallet performs directly (e.g. CCTP relay). */
  calls: z.array(CallSchema),
  /** Tx the agent wallet sends directly (not through the account), e.g. receiveMessage. */
  direct: z.object({ to: z.string(), data: z.string() }).optional(),
  status: z.enum(["pending", "simulated", "awaiting_guardian", "executing", "done", "failed", "skipped"]).default("pending"),
  txHash: z.string().optional(),
  explorer: z.string().optional(),
  simulation: z.object({ ok: z.boolean(), revertReason: z.string().optional(), notes: z.array(z.string()) }).optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const RepayIntentSchema = z.object({
  kind: z.literal("repay"),
  amountUsdc: z.number().positive().describe("USDC to repay into the lending market"),
  repaymentId: z.number().int().min(0).optional().describe("index in MandateAccount.repayments on Arc, if repaying a scheduled intent"),
  withdrawCollateral: z.boolean().default(true).describe("withdraw freed WETH collateral after repaying"),
});
export type RepayIntent = z.infer<typeof RepayIntentSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  intent: z.union([IntentSchema, RepayIntentSchema]),
  venueId: z.string(),
  venueExplanation: z.string(),
  account: z.string(),
  collateralWeth: z.string(), // 18-dec string (collateral added, or withdrawn for repay plans)
  projected: z.object({ healthFactor: z.number(), liquidationPriceUsd: z.number().nullable(), borrowAprPct: z.number(), wethPriceUsd: z.number() }),
  steps: z.array(StepSchema),
});
export type Plan = z.infer<typeof PlanSchema>;
