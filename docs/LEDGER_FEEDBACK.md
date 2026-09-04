# Ledger Agent Stack — developer feedback (living document)

Kept from day one of the build. Each entry: what we tried, what happened, what we expected, suggestion.

## Context

Mandate uses a Ledger device as the **guardian** of an AI agent: any irreversible or over-limit step the agent proposes must be co-signed on the device. We also use `wallet-cli ring` to hold the agent's API secrets.

## Entries

### 1. Design decision: EIP-191 text instead of EIP-712 or calldata
- Our contracts have no Crypto Assets List descriptors, so a contract call from the device would require **blind signing** (SW 0x6a80 when disabled). EIP-712 without CAL filters also falls back to blind signing.
- Instead the guardian signs a fixed-format ASCII message which the contract rebuilds and verifies (`MandateAccount.approvalText`). The device screen shows the plan step in words.
- Suggestion: a documented "clear-signed approval message" pattern for agent builders, plus a self-serve way to register EIP-712 filters for testnet contracts.

*(more entries added as the build progresses)*
