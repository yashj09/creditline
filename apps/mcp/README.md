# @yashjain99/mandate-mcp

An MCP server that lets Claude Desktop, Cursor or any MCP client operate a Mandate account: borrow, bridge, pay and repay USDC under an on-chain mandate, pausing for the human's Ledger on irreversible steps.

```bash
npx @yashjain99/mandate-mcp            # stdio
npx @yashjain99/mandate-mcp --http 3111
```

Env: `MANDATE_ACCOUNT`, `AGENT_PRIVATE_KEY` (or `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` + `CIRCLE_WALLET_SET_ID`), optional `BASE_SEPOLIA_RPC`, `ARC_TESTNET_RPC`, `GRAPH_API_KEY`, `MANDATE_STORE_DIR` (default `~/.mandate`), `MANDATE_ENV_FILE`.

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "mandate": { "command": "npx", "args": ["-y", "@yashjain99/mandate-mcp"], "env": { "MANDATE_ACCOUNT": "0x…", "AGENT_PRIVATE_KEY": "0x…", "GRAPH_API_KEY": "…" } } } }
```

Tools: `get_positions`, `get_markets`, `draft_plan`, `simulate_plan`, `prepare_step`, `submit_guardian_signature`, `execute_step`, `check_repayments`, `draft_repayment_plan`, `get_plan`, `get_audit`. Guardian flow: `prepare_step` returns the approval text → sign it on the Ledger (personal_sign, clear-signed) → `submit_guardian_signature` → `execute_step`.

Pair with the `mandate-agent` skill: `npx skills add yashj09/mandate -s mandate-agent`. MIT.
