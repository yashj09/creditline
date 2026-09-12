// The web console is one surface over the published packages; the MCP server is another.
import { resolve } from "node:path";
import { createMandateFromEnv, fileStore, type MandateClient } from "@yashjain99/mandate-sdk";
import { MANDATE_SYSTEM_PROMPT, mandateToolApproval, mandateTools, runRepaymentCheck, summarizePlan } from "@yashjain99/mandate-ai";

// Everything is lazy: nothing touches env or the chain at import time, so read-only routes and `next build` work
// without an agent key (the SDK falls back to a read-only wallet when AGENT_PRIVATE_KEY is absent).
let _client: MandateClient | undefined;
export function getClient(): MandateClient {
  _client ??= createMandateFromEnv({ store: fileStore(process.env.MANDATE_STORE_DIR ?? resolve(process.cwd(), "../../.data")) });
  return _client;
}
let _tools: ReturnType<typeof mandateTools> | undefined;
export const getTools = () => (_tools ??= mandateTools(getClient()));
export const getToolApproval = () => mandateToolApproval(getClient());
export const SYSTEM_PROMPT = MANDATE_SYSTEM_PROMPT;
export const cron = (days?: number) => runRepaymentCheck(getClient(), days);
export { summarizePlan };
