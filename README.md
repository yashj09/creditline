# Mandate

**Claude executes real on-chain financial actions for you, inside limits you set, with a hardware tap for anything irreversible.**

> ETHOnline 2026 · Start Fresh track · Sponsors: Arc (Circle), The Graph, Ledger

Tell the agent *"I need 500 USDC on Arc by Friday to pay Acme. Don't sell my ETH."* It shops borrow rates across lending protocols with one standardized query on The Graph, drafts and simulates a plan, borrows real USDC against your WETH on Compound v3 (Base Sepolia), bridges it to Arc over CCTP v2, pays the recipient, and schedules the repayment. Every step is checked on-chain against a **mandate** you control; irreversible or over-limit steps wait for a **Ledger co-signature**, clear-signed as plain text.

## Status

Day 1–2 (Sept 5): contracts + core done and tested; testnet deployment pending funded keys.

- `contracts/`: `forge test` — 25 unit tests + a Base Sepolia fork test that supplies WETH, borrows real Circle USDC from Compound v3 through the account, and executes a guardian-signed CCTP burn towards Arc.
- `packages/core`: execution encoders, Circle/local agent wallets, standardized-subgraph market fetcher, deterministic plan builder, step simulation, JSONL audit, `scripts/e2e.ts`.

### Run

```bash
git clone --recursive <repo> && cd mandate && pnpm install
cd contracts && forge test                                  # unit tests
BASE_SEPOLIA_RPC=https://sepolia.base.org forge test --match-contract Fork -vv   # fork test
cd ../packages/core && pnpm gen:abi && pnpm typecheck && pnpm test
GRAPH_API_KEY=… pnpm exec tsx scripts/probe-markets.ts     # venue table from The Graph
```

## Layout

```
contracts/       Foundry — MandateAccount, MandateFactory, tests, deploy scripts
packages/core/   TypeScript core — markets (The Graph), plan, sim, exec, wallet (Circle), approval, audit
apps/web/        Next.js console + chat (Vercel AI SDK, tool approvals, Ledger WebHID)
apps/mcp/        MCP server exposing the same tools to Claude Desktop / Claude Code
docs/            ARCHITECTURE, LEDGER_FEEDBACK, DEMO, MAINNET
```

## Sponsor integration map

| Sponsor | Where |
|---|---|
| Arc / Circle | `contracts/` deployed on Arc testnet; `packages/core/exec/cctp.ts`; `packages/core/wallet/circle.ts` (developer-controlled wallets); USDC settlement + repayment schedule on Arc |
| The Graph | `packages/core/markets/graph.ts` — one Messari standardized-lending query across Aave v3 / Compound v3 / Spark subgraphs |
| Ledger | `apps/web/lib/ledger.ts` (DMK + WebHID clear-signed approvals), `packages/core/secrets/keyring.ts` (Key Ring CLI), `docs/LEDGER_FEEDBACK.md` |

## License

MIT
