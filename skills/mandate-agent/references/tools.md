# Tool reference

| Tool | Input | Output (key fields) |
|---|---|---|
| `get_positions` | — | `account, agent, guardian, baseSepolia{eth,usdc}, arc{usdcNative}, compound{debtUsdc,healthFactor,liquidationPriceUsd,borrowAprPct}, mandate{perTxCapUsdc,dailyCapUsdc,dailyRemainingUsdc,expiresAt,active}` |
| `get_markets` | `amountUsdc` | `table[]{venueId,borrowAprPct,utilizationPct,availableUsd,executableOn}`, `recommended`, `cheapestMainnet`, `explanation`, `warnings` |
| `draft_plan` | `intent{kind:"liquidity",amountUsdc,recipient?,constraints{doNotSell[]},repayInDays}` | `planId`, `steps[]{step,kind,title,reversible,requiresGuardian,maxUsdcOut,status}`, `projected{healthFactor,liquidationPriceUsd}` |
| `simulate_plan` | `planId` | `results[]{step,ok,deferred,revertReason}`, `verified`, `deferred`, `failed` |
| `execute_step` | `planId, step` | `ok, txHash, explorer, summary, healthFactor?, mintedUsdc?` or `awaitingGuardian: true` or `error` |
| `prepare_step` (MCP) | `planId, step` | executes agent-only steps; for guardian steps returns `approval{text,guardian,chainId,deadline,nonce}` |
| `submit_guardian_signature` (MCP) | `planId, step, signature` | `ok` or `error` |
| `check_repayments` | — | `repayments[]{id,dueAt,amountUsdc,done,daysLeft,overdue}`, `currentDebtUsdc`, `healthFactor` |
| `draft_repayment_plan` | `intent{kind:"repay",amountUsdc,repaymentId?,withdrawCollateral}` | plan summary |
| `get_plan` / `get_audit` | `planId` / `planId?` | plan summary / audit entries |

Step kinds: `supply_borrow` (agent), `bridge_burn` (guardian), `bridge_relay` (agent), `pay` (guardian), `schedule_repayment` (agent), `repay` (agent), `mark_repaid` (agent).
