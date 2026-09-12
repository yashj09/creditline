/**
 * Hand-Drawn design tokens shared by the ui/* primitives.
 * The CSS source of truth lives in app/globals.css (@theme / @utility); these
 * TS mirrors exist for SVGs, tone → class maps and deterministic layout helpers.
 */

export const wobbly = "255px 15px 225px 15px / 15px 225px 15px 255px";
export const wobblyMd = "125px 10px 120px 10px / 10px 120px 10px 125px";
export const wobblySm = "25px 8px 22px 8px / 8px 22px 8px 25px";

export const PENCIL = "#2d2d2d";
export const INK = "#2d5da1";
export const MARKER = "#ff4d4d";
export const POSTIT = "#fff9c4";
export const MUTED = "#e5e0d8";

/** Deterministic tilt for lists: SSR-safe (never Math.random). */
const TILTS = ["-rotate-2", "-rotate-1", "rotate-1", "rotate-2"] as const;
export const tilt = (i: number) => TILTS[Math.abs(i) % TILTS.length];

export type Tone = "default" | "ok" | "warn" | "bad" | "muted" | "postit";

/**
 * Strict-palette semantics:
 *  ok   = blue ballpoint (done / reversible / recommended)
 *  warn = post-it fill + pencil text (guardian / pending irreversible) — yellow is never a text colour
 *  bad  = red marker (failed / denied / irreversible)
 */
export const tone: Record<Tone, { border: string; bg: string; text: string; fill: string; tail: string }> = {
  default: { border: "border-fg", bg: "bg-card", text: "text-fg", fill: "bg-fg text-white", tail: "after:border-t-card" },
  ok: { border: "border-ink", bg: "bg-card", text: "text-ink", fill: "bg-ink text-white", tail: "after:border-t-card" },
  warn: { border: "border-fg", bg: "bg-postit", text: "text-fg", fill: "bg-postit text-fg", tail: "after:border-t-postit" },
  bad: { border: "border-accent", bg: "bg-card", text: "text-accent", fill: "bg-accent text-white", tail: "after:border-t-card" },
  muted: { border: "border-fg/40", bg: "bg-muted", text: "text-fg/60", fill: "bg-muted text-fg/70", tail: "after:border-t-muted" },
  postit: { border: "border-fg", bg: "bg-postit", text: "text-fg", fill: "bg-postit text-fg", tail: "after:border-t-postit" },
};

/** Plan step status → tone (Cards.StatusPill). */
export const statusTone = (s: string): Tone =>
  ({ done: "ok", executing: "ok", failed: "bad", awaiting_guardian: "warn", simulated: "muted", pending: "muted" } as Record<string, Tone>)[s] ?? "muted";

/** Audit entry kind → tone (activity page, landing receipts). */
export const auditTone = (k: string): Tone =>
  ({ execute: "ok", "guardian-approved": "ok", "guardian-request": "warn", error: "bad", plan: "default", simulate: "muted", info: "muted" } as Record<string, Tone>)[k] ?? "muted";

/** Tiny class joiner so we don't need clsx. */
export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");
