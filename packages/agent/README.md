# @yashjain99/mandate-ai

Mandate for agent frameworks: Vercel AI SDK tools with a tool-approval policy, MCP tool registration, and the system prompt.

```bash
npm i @yashjain99/mandate-ai @yashjain99/mandate-sdk ai zod
```

```ts
import { streamText, stepCountIs } from "ai";
import { createMandateFromEnv } from "@yashjain99/mandate-sdk";
import { mandateTools, mandateToolApproval, MANDATE_SYSTEM_PROMPT } from "@yashjain99/mandate-ai";

const client = createMandateFromEnv();
const result = streamText({
  model,
  system: MANDATE_SYSTEM_PROMPT,
  messages,
  tools: mandateTools(client),
  toolApproval: mandateToolApproval(client),   // guardian steps pause for the human
  stopWhen: stepCountIs(16),
});
```

Tools: `get_positions`, `get_markets`, `draft_plan`, `simulate_plan`, `execute_step`, `check_repayments`, `draft_repayment_plan`, `get_plan`, `get_audit`.

MCP: `registerMandateMcpTools(server, client)` adds the same tools plus `prepare_step` / `submit_guardian_signature` (the guardian pause made explicit for request/response clients). For a ready-made server use `@yashjain99/mandate-mcp`.

Cron: `runRepaymentCheck(client, remindDays)` writes reminders for due repayments; it never moves money. MIT.
