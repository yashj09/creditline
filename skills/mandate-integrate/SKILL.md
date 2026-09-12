---
name: mandate-integrate
description: Add Mandate (bounded delegation with a hardware guardian) to an existing AI agent or app — install the SDK, wire tools into the Vercel AI SDK or an MCP server, deploy a MandateAccount, write policy presets and action adapters. Use when a developer asks to give their agent a wallet with limits, human approval on irreversible actions, or to integrate a protocol with Mandate.
---

# Integrating Mandate

Packages: `@yashjain99/mandate-sdk` (client, actions, stores, guardians), `@yashjain99/mandate-ai` (Vercel AI SDK tools + MCP registration), `@yashjain99/mandate-mcp` (ready-made MCP server). Contracts: `MandateAccount` + `MandateFactory` (Foundry, `contracts/`).

## 1. Deploy an account (once per user)

`forge script script/Deploy.s.sol --rpc-url <chain> --broadcast` on every chain the account should live on (same owner, guardian, agent, salt → same address). Apply a policy with `script/SetPolicy.s.sol` or `ownerEncoders.setPolicies(policyPresets.forChain(chainId))` from any owner wallet. The owner sets caps with `setMandate(perTx, daily, expiry)`.

## 2. Create a client

```ts
import { createMandate, fileStore, LocalAgentWallet, chains } from "@yashjain99/mandate-sdk";
const client = createMandate({
  account: "0x…",                                   // MandateAccount
  wallet: new LocalAgentWallet(agentKey, { 84532: chains.baseSepolia, 5042002: chains.arcTestnet }),  // or CircleAgentWallet
  store: fileStore(".mandate"),                     // or memoryStore() / your own Store
  graphApiKey: process.env.GRAPH_API_KEY,           // The Graph standardized subgraphs
  // guardian: ledgerNodeGuardian()                 // optional: auto-sign guardian steps on a Ledger over USB
});
```
Or `createMandateFromEnv()` (Node) to read everything from env.

## 3. Wire the agent

- Vercel AI SDK: `tools: mandateTools(client)`, `toolApproval: mandateToolApproval(client)`, `system: MANDATE_SYSTEM_PROMPT`. Guardian steps surface as approval requests; your UI fetches `client.approvals.request(plan, step)`, has the Ledger sign `text` (`ledgerWebGuardian()` from `@yashjain99/mandate-sdk/ledger-web`), then `client.approvals.submit(plan, step, signature)` and approves the tool call.
- MCP: `registerMandateMcpTools(server, client)` on any `McpServer`, or just run `npx @yashjain99/mandate-mcp`.
- No framework: `recipes.liquidity(client, intent)` → `client.simulate(plan)` → `client.executeAll(plan)`.

## 4. Add your protocol (ActionAdapter)

```ts
import { registerAction, type ActionAdapter } from "@yashjain99/mandate-sdk";
export const myDeposit: ActionAdapter<{ amountUsdc6: bigint }> = {
  kind: "my_deposit" as any,          // extend StepKind in your fork, or reuse an existing kind semantics
  chainId: () => 84532,
  reversible: true,
  guardianRule: "policy",             // defer to the account's on-chain allow-list
  async build(p, ctx) {
    return { title: `Deposit ${Number(p.amountUsdc6)/1e6} USDC into MyVault`, description: "…", maxUsdcOut: p.amountUsdc6,
      calls: [{ target: USDC, value: 0n, data: encodeApprove(VAULT, p.amountUsdc6) }, { target: VAULT, value: 0n, data: encodeDeposit(p.amountUsdc6) }] };
  },
};
registerAction(myDeposit);
```
Ship a policy preset alongside: which `(target, selector)` pairs are allowed and which need the guardian. Rules of thumb: anything that sends value to a third party or across chains → `requiresGuardian: true`; approvals and protocol interactions whose value stays recoverable → agent-only. Caps are measured on the account's gross USDC outflow per call, so an adapter cannot hide a payment behind an inflow.

See `references/adapter.md` (adapter contract, idempotency hooks) and `references/policy.md` (policy model, caps, approval message spec).
