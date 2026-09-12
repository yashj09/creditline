import { convertToModelMessages, createUIMessageStreamResponse, stepCountIs, streamText, toUIMessageStream, type UIMessage } from "ai";
import { model } from "@/lib/model";
import { SYSTEM_PROMPT, getToolApproval, getTools } from "@/lib/agent";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const result = streamText({
    model: model(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: getTools(),
    stopWhen: stepCountIs(16),
    // Guardian steps pause here; the UI collects the Ledger signature via /api/approval, then approves.
    toolApproval: getToolApproval(),
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET ?? "dev-only-secret-change-me",
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
