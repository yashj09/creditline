# Policy, caps and approvals

**Policy** — `policies[target][selector] = { set, allowed, requiresGuardian }`. A specific entry wins (including an explicit deny); unset falls back to the wildcard `address(0)`. Selector `0x00000000` covers plain value transfers. Owner-only: `setPolicy`, `setPolicies`, `clearPolicy`.

**Mandate** — `{ perTxCap, dailyCap, expiry }` in USDC 6-dec. Enforced on *measured gross outflow* per call (ERC-20 balance on Base; native balance on Arc where USDC is gas). Inflows never offset outflows. Guardian-approved steps bypass caps but are bound by the approved `maxUsdcOut`.

**Guardian approval (spec: docs/SPEC-approval-message-v1.md)** — EIP-191 personal_sign over:
```
Mandate approval
Account: 0x…
Chain: <chainId>
Plan: 0x<bytes32>
Step: <n>
Max USDC out: <d.dddddd>
Calls: 0x<keccak256(abi.encode(calls))>
Deadline: <unix>
Nonce: <guardianNonce>
```
The contract rebuilds the text and recovers the signer; a Ledger clear-signs it without blind signing. Nonce and the per-step `executed` flag prevent replay; deadline bounds validity.
