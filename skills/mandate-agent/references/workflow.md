# Worked example

User: "I need 100 USDC on Arc by Friday to pay 0xd77c…EFF5. Don't sell my ETH."

1. `get_positions` → 0.06 ETH on Base Sepolia, no debt, cap 100/tx, 500/day, guardian = Ledger.
2. `get_markets({amountUsdc:100})` → cheapest observed: Compound v3 Arbitrum 2.93%; executable: Compound v3 Base Sepolia 1.53%. Say both.
3. `draft_plan` → 5 steps: borrow (agent) → bridge (guardian) → mint (agent) → pay (guardian) → schedule repayment (agent). HF 1.60, liquidation at $2,173.
4. `simulate_plan` → 1 verified, 4 deferred, 0 failing. Proceed.
5. `execute_step 1` → tx link, HF 1.60.
6. Before step 2: "Your Ledger will show: Mandate approval · Chain 84532 · Step 2 · Max USDC out 100.000000 · … Approve to burn 100 USDC on Base for a mint on Arc; this cannot be undone."
7. `execute_step 2` → pauses (`awaitingGuardian`) until signed → then tx link. `execute_step 3` → "Minted 99.987 USDC on Arc". Step 4 → second tap. Step 5 → repayment recorded.
8. Summary: moved 100 USDC Base → Arc → recipient; debt 100 USDC at 1.53%; HF 1.60; repay by Sept 16; ETH untouched; 29.99 USDC already on Arc untouched.
