// The web console is one surface over the published packages; the MCP server is another.
import { resolve } from "node:path";
import { createMandateFromEnv, fileStore, type MandateClient } from "@yashjain99/mandate-sdk";
import { MANDATE_SYSTEM_PROMPT, mandateToolApproval, mandateTools, runRepaymentCheck, summarizePlan } from "@yashjain99/mandate-ai";

let _client: MandateClient | undefined;
/** Singleton client for this process. Store: workspace-root .data (shared with the scripts). */
export function getClient(): MandateClient {
  _client ??= createMandateFromEnv({ store: fileStore(process.env.MANDATE_STORE_DIR ?? resolve(process.cwd(), "../../.data")) });
  return _client;
}
export const tools = mandateTools(getClient());
export const toolApproval = mandateToolApproval(getClient());
export const SYSTEM_PROMPT = MANDATE_SYSTEM_PROMPT;
export const cron = (days?: number) => runRepaymentCheck(getClient(), days);
export { summarizePlan };
