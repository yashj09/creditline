"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { useState } from "react";
import { ApprovalSheet } from "@/components/ApprovalSheet";
import { PlanCard, PositionsCard, SimulationCard, StepReceipt, VenueTable } from "@/components/Cards";

const SUGGESTIONS = [
  "I need 100 USDC on Arc by Friday to pay 0x000000000000000000000000000000000000dEaD. Don't sell my ETH.",
  "What are the cheapest USDC borrow rates right now?",
  "Show my positions and remaining mandate.",
];

export default function ChatPage() {
  const { messages, sendMessage, addToolApprovalResponse, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const [input, setInput] = useState("");

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_280px]">
      <section>
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="panel p-6">
              <h1 className="mb-1 text-xl font-semibold">Tell the agent what you need.</h1>
              <p className="muted mb-4 text-sm">It borrows against your ETH, bridges to Arc, pays, and schedules repayment — inside your mandate. Irreversible steps wait for your Ledger.</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn btn-ghost text-xs" onClick={() => sendMessage({ text: s })}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[85%]" : "max-w-[95%]"}>
              <div className="muted mb-1 text-[11px] uppercase tracking-wide">{m.role === "user" ? "you" : "mandate"}</div>
              {m.parts.map((part: any, i) => {
                if (part.type === "text") return <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{part.text}</p>;
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
                  if (part.state === "output-denied") return <div key={i} className="panel my-2 p-3 text-sm" style={{ borderColor: "var(--bad)" }}>Step {part.input.step} denied by guardian.</div>;
                  if (part.state === "input-available" || part.state === "input-streaming") return <div key={i} className="muted text-xs">executing step {part.input?.step}…</div>;
                }
                if (typeof part.type === "string" && part.type.startsWith("tool-") && part.state === "output-error") {
                  return <div key={i} className="text-xs" style={{ color: "var(--bad)" }}>{part.errorText}</div>;
                }
                return null;
              })}
            </div>
          ))}
          {status === "streaming" || status === "submitted" ? <div className="muted text-xs">thinking…</div> : null}
        </div>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (!input.trim()) return; sendMessage({ text: input }); setInput(""); }}
        >
          <input className="panel flex-1 px-4 py-3 text-sm outline-none" value={input} onChange={(e) => setInput(e.target.value)} placeholder="I need 100 USDC on Arc by Friday…" />
          <button className="btn btn-primary" type="submit" disabled={status !== "ready"}>Send</button>
        </form>
      </section>
      <aside className="space-y-3 text-xs">
        <div className="panel p-4">
          <div className="mb-2 font-semibold">How authority works</div>
          <ul className="muted space-y-1">
            <li>• Allow-listed actions inside caps run autonomously.</li>
            <li>• Bridging and paying third parties are irreversible → Ledger tap.</li>
            <li>• Caps are enforced on measured USDC outflow, on-chain.</li>
            <li>• The Ledger clear-signs plain text; the contract rebuilds it.</li>
          </ul>
        </div>
        <div className="panel p-4">
          <div className="mb-2 font-semibold">Rails</div>
          <ul className="muted space-y-1">
            <li>• Borrow: Compound v3 · Base Sepolia (real USDC)</li>
            <li>• Bridge: Circle CCTP v2 Fast Transfer → Arc</li>
            <li>• Pay & repay schedule: Arc (USDC gas)</li>
            <li>• Rates: The Graph standardized subgraphs</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
