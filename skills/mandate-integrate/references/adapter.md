# ActionAdapter contract

```ts
interface ActionAdapter<P> {
  kind: StepKind;
  chainId(params, ctx): number;
  reversible: boolean;                       // shown to the human; irreversible steps are explained before approval
  guardianRule: "never" | "always" | "policy";
  build(params, ctx): Promise<{ title; description; calls: Call[]; maxUsdcOut: bigint; direct?: {to,data}; projection? }>;
  isExecuted?(params, ctx): Promise<boolean>;      // on-chain probe for direct (non-account) steps; call-steps use the account's per-step flag
  resolveDirect?(params, ctx): Promise<{to,data}>; // when direct calldata depends on runtime data (e.g. a CCTP attestation)
  afterExecute?(params, receipt, ctx): Promise<Record<string, unknown>>;  // enrichment only; errors become notes
}
```

- `calls` are routed through `MandateAccount.execute` (agent) or `executeWithGuardian` (guardian signature). Every `(target, selector)` must be allow-listed on-chain or the plan is rejected at build time.
- `maxUsdcOut` is the binding maximum for guardian steps: the contract measures the real gross outflow and reverts with `MaxOutExceeded` if the calls move more than the human approved.
- Params are persisted as JSON: bigints come back as strings — coerce with `BigInt()` in `isExecuted`/`resolveDirect`.
- Idempotency: the executor consults the chain before every send (per-step `executed` flag, your `isExecuted`), so a crash between send and persist never double-executes.
