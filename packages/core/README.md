# @yashjain99/mandate-sdk

Bounded delegation for AI agents. A user owns a `MandateAccount` smart account; the agent may act through it inside an on-chain allow-list and USDC caps; anything irreversible or over-cap needs a guardian signature, clear-signed on a Ledger. This SDK plans, simulates and executes steps against that account, handles approvals, and reads live market data from The Graph.

```bash
npm i @yashjain99/mandate-sdk viem
```

```ts
import { createMandate, fileStore, LocalAgentWallet, chains, recipes, ledgerNodeGuardian } from "@yashjain99/mandate-sdk";

const client = createMandate({
  account: "0x58612CE0945666cf58CA7e24808625a3cF10C5c3",
  wallet: new LocalAgentWallet(process.env.AGENT_PRIVATE_KEY, { 84532: chains.baseSepolia, 5042002: chains.arcTestnet }),
  store: fileStore(".mandate"),
  graphApiKey: process.env.GRAPH_API_KEY,
  guardian: ledgerNodeGuardian(),   // optional: co-sign on a Ledger over USB; omit to collect signatures yourself
});

const plan = await recipes.liquidity(client, { kind: "liquidity", amountUsdc: 100, destinationChainId: 5042002, recipient: "0x…", constraints: { doNotSell: ["ETH"] }, repayInDays: 7 });
await client.simulate(plan);
await client.executeAll(plan, (r) => console.log(r));
```

## What you get

- **`MandateClient`** — `positions()`, `markets(amount)`, `plan(actions)`, `simulate(plan)`, `execute(plan, step)`, `executeAll`, `approvals.request/submit/signWith`, `repayments()`.
- **Actions** — pluggable `ActionAdapter`s; built-ins for Compound v3 (supply/borrow, repay), Circle CCTP v2 (burn, relay), USDC payments, repayment intents. `registerAction()` to add your protocol.
- **Recipes** — `recipes.liquidity`, `recipes.repayment`: the two end-to-end flows, as ordinary action lists.
- **Stores** — `memoryStore()`, `fileStore(dir)`, or implement `Store` for your database.
- **Guardians** — `localGuardian` (tests), `ledgerNodeGuardian` (USB), `ledgerWebGuardian` from `@yashjain99/mandate-sdk/ledger-web` (browser WebHID).
- **Wallets** — `LocalAgentWallet` (viem), `CircleAgentWallet` (Circle developer-controlled wallets).
- **Account helpers** — `policyPresets`, `ownerEncoders` (setMandate, setPolicies, setGuardian…), `computeAccountAddress`, ABIs.
- **Approval message spec** — `approvalText`, `callsHash`, `verifyGuardianSignature` (SPEC-approval-message-v1).

Safety properties (enforced by the contract, not the SDK): gross USDC outflow is measured per call; each (plan, step) executes at most once; guardian approvals are nonce- and deadline-bound and cap the approved amount; the allow-list cannot be lifted by a guardian signature.

Chains today: Base Sepolia (Compound v3, real Circle USDC) and Circle Arc testnet (USDC gas). Contracts and docs: https://github.com/yashj09/mandate. MIT.
