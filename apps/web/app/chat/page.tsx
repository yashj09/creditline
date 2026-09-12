"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { useState } from "react";
import { Check, Route, ShieldCheck } from "lucide-react";
import { ApprovalSheet } from "@/components/ApprovalSheet";
import { Markdown } from "@/components/Markdown";
import { PlanCard, PositionsCard, SimulationCard, StepReceipt, VenueTable } from "@/components/Cards";
import { Button, Card, Icon, Input, SketchHeading } from "@/components/ui";

const SUGGESTIONS = [
  "I need 100 USDC on Arc by Friday to pay 0x000000000000000000000000000000000000dEaD. Don't sell my ETH.",
  "What are the cheapest USDC borrow rates right now?",
  "Show my positions and remaining mandate.",
];

const AUTHORITY = [
  "Allow-listed actions inside caps run autonomously.",
  "Bridging and paying third parties are irreversible → Ledger tap.",
  "Caps are enforced on measured USDC outflow, on-chain.",
  "The Ledger clear-signs plain text; the contract rebuilds it.",
];

const RAILS = [
  "Borrow: Compound v3 · Base Sepolia (real USDC)",
  "Bridge: Circle CCTP v2 Fast Transfer → Arc",
  "Pay & repay schedule: Arc (USDC gas)",
  "Rates: The Graph standardized subgraphs",
];

export default function ChatPage() {
  const { messages, sendMessage, addToolApprovalResponse, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState("");

  const renderPart = (part: any, i: number, role: string) => {
    if (part.type === "text") {
      return role === "user"
        ? <p key={i} className="whitespace-pre-wrap text-lg leading-relaxed">{part.text}</p>
        : <Markdown key={i}>{part.text}</Markdown>;
    }
    if (part.type === "tool-get_positions" && part.state === "output-available") return <PositionsCard key={i} data={part.output} />;
    if (part.type === "tool-get_markets" && part.state === "output-available") return <VenueTable key={i} data={part.output} />;
    if ((part.type === "tool-draft_plan" || part.type === "tool-get_plan") && part.state === "output-available") return <PlanCard key={i} plan={part.output} />;
    if (part.type === "tool-simulate_plan" && part.state === "output-available") return <SimulationCard key={i} data={part.output} />;
    if (part.type === "tool-execute_step") {
      if (part.state === "approval-requested") {
        return (
          <ApprovalSheet
            key={part.toolCallId}
            planId={part.input.planId}
            step={part.input.step}
            onDecision={(approved) => addToolApprovalResponse({ id: part.approval.id, approved, reason: approved ? "signed on guardian device" : "denied by user" })}
          />
        );
      }
      if (part.state === "output-available") return <StepReceipt key={i} out={part.output} />;
      if (part.state === "output-denied") {
        return (
          <Card key={i} tone="bad" padding="sm" className="my-3 text-lg">
            Step {part.input.step} denied by guardian.
          </Card>
        );
      }
      if (part.state === "input-available" || part.state === "input-streaming") {
        return <div key={i} className="animate-pulse text-base text-fg/60">executing step {part.input?.step}…</div>;
      }
    }
    if (typeof part.type === "string" && part.type.startsWith("tool-") && part.state === "output-error") {
      return <p key={i} className="text-base font-bold text-accent">{part.errorText}</p>;
    }
    return null;
  };

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_300px]">
      <section>
        <div className="space-y-5">
          {messages.length === 0 && (
            <Card decoration="tape" padding="lg">
              <SketchHeading as="h1" underline="highlight" className="mb-4">Tell the agent what you need.</SketchHeading>
              <p className="mb-6 max-w-2xl text-lg text-fg/70 md:text-xl">
                It borrows against your ETH, bridges to Arc, pays, and schedules repayment — inside your mandate. Irreversible steps wait for your Ledger.
              </p>
              <div className="flex flex-wrap gap-3">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="ghost" size="sm" className="h-auto whitespace-normal text-left" onClick={() => sendMessage({ text: s })}>
                    {s}
                  </Button>
                ))}
              </div>
            </Card>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <Card key={m.id} speech tone="postit" padding="sm" className="ml-auto max-w-[85%]">
                <div className="mb-1 font-heading text-sm uppercase tracking-wide text-fg/60">you</div>
                {m.parts.map((part: any, i) => renderPart(part, i, "user"))}
              </Card>
            ) : (
              <div key={m.id} className="max-w-[95%]">
                <div className="mb-1 font-heading text-sm uppercase tracking-wide text-fg/60">mandate</div>
                {m.parts.map((part: any, i) => renderPart(part, i, "assistant"))}
              </div>
            ),
          )}
          {status === "streaming" || status === "submitted" ? <div className="animate-pulse text-base text-fg/60">thinking…</div> : null}
        </div>
        <form
          className="mt-8 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => { e.preventDefault(); if (!input.trim()) return; sendMessage({ text: input }); setInput(""); }}
        >
          <Input aria-label="Message the agent" value={input} onChange={(e) => setInput(e.target.value)} placeholder="I need 100 USDC on Arc by Friday…" />
          <Button variant="primary" type="submit" disabled={status !== "ready"} className="sm:min-w-28">Send</Button>
        </form>
      </section>

      <aside className="space-y-8 text-base">
        <Card decoration="tack" rotate={1}>
          <div className="mb-3 flex items-center gap-3">
            <Icon icon={ShieldCheck} size="sm" />
            <h3 className="font-heading text-xl">How authority works</h3>
          </div>
          <ul className="space-y-2 text-fg/80">
            {AUTHORITY.map((t) => (
              <li key={t} className="flex gap-2">
                <Check size={18} strokeWidth={3} className="mt-1 shrink-0 text-ink" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card decoration="tape" rotate={2}>
          <div className="mb-3 flex items-center gap-3">
            <Icon icon={Route} size="sm" />
            <h3 className="font-heading text-xl">Rails</h3>
          </div>
          <ul className="space-y-2 text-fg/80">
            {RAILS.map((t) => (
              <li key={t} className="flex gap-2">
                <Check size={18} strokeWidth={3} className="mt-1 shrink-0 text-ink" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}
