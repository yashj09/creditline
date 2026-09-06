import { convertToModelMessages, createUIMessageStreamResponse, stepCountIs, streamText, toUIMessageStream, type UIMessage } from "ai";
import { model } from "@/lib/model";
import { tools } from "@/lib/agent";
import { SYSTEM_PROMPT } from "@/lib/agent";
import { plans } from "@/lib/agent";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: model(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(16),
    toolApproval: {
      // Guardian steps pause here; the UI collects the Ledger signature, posts it to /api/approval, then approves.
      execute_step: async ({ planId, step }) => {
        const plan = plans.get(planId);
        const s = plan?.steps.find((x) => x.index === step);
        return s?.requiresGuardian ? "user-approval" : undefined;
      },
    },
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET ?? "dev-only-secret-change-me",
  });

  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
