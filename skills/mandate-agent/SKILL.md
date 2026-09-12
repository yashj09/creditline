---
name: mandate-agent
description: Operate a Mandate account as an AI agent — borrow, bridge, pay and repay USDC under an on-chain mandate, pausing for the human's Ledger on irreversible steps. Use when the user asks the agent to get liquidity, move USDC to Arc, pay someone from their Mandate account, or repay a loan, and Mandate tools (MCP or SDK) are available.
---

# Mandate — operating guide for agents

Mandate gives you a bounded wallet: a smart account owned by the human, with an on-chain allow-list, a per-transaction cap and a rolling 24-hour cap on USDC leaving the account. Steps inside the mandate run on your say-so. Steps that move value irreversibly (CCTP burns, payments to third parties) or exceed the caps require the human's guardian signature, normally a Ledger. You cannot bypass this; do not try.

## The loop

1. `get_positions` — balances on both chains, Compound debt and health factor, caps and remaining daily allowance, guardian and agent addresses. Always first.
2. `get_markets` — live USDC borrow rates from The Graph's standardized subgraphs plus Morpho. Explain the venue choice: cheapest observed rate, and where execution actually happens (testnet twin).
3. `draft_plan` with a structured intent (`amountUsdc`, optional `recipient`, `constraints.doNotSell`, `repayInDays`). If the user speaks in another currency, convert approximately, say the rate, keep USDC as the unit.
4. `simulate_plan` — read `verified`, `deferred`, `failed`. Deferred means only the allow-list was checked because the step depends on earlier steps; it is re-simulated against live state right before execution. Stop on any `failed`.
5. `execute_step` one at a time, in order.
   - MCP: use `prepare_step`; for guardian steps it returns `approval.text`. Show it to the human, have them sign it (Ledger clear-signs it), then `submit_guardian_signature` with only the signature, then `execute_step`.
   - Vercel AI SDK: the tool pauses with a user-approval request; the host UI collects the signature.
   - Before a guardian step, tell the human exactly what they will see and why it is irreversible.
6. After each step report the explorer link; after a borrow report health factor and liquidation price.
7. Finish with: what moved where, cost, repayment date, and what you did not do.

Repayment: `check_repayments` → `draft_repayment_plan` → simulate → execute. The bridge back from Arc needs the guardian; repaying and withdrawing collateral do not.

## Rules

- Never invent hashes, balances or rates; report tool outputs only.
- A step that returns `alreadyDone: true` landed in an earlier attempt; do not resend, move on.
- `awaitingGuardian: true` means stop and ask the human; do not loop.
- Errors like `PerTxCapExceeded`, `DailyCapExceeded`, `GuardianRequired`, `CallNotAllowed` are the mandate working as intended. Explain, propose a smaller amount or ask the owner to change the mandate. Never suggest workarounds.
- Distinguish clearly between what ran autonomously and what needed a tap.

See `references/tools.md` for every tool's inputs and outputs and `references/workflow.md` for a worked transcript.
