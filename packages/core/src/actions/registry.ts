import type { ActionAdapter } from "./types.ts";
import type { StepKind } from "../plan/schema.ts";

const registry = new Map<string, ActionAdapter>();

/** Register (or override) an adapter. Third parties call this to add their protocol. */
export function registerAction(adapter: ActionAdapter): void {
  registry.set(adapter.kind, adapter);
}

let ensureDefaults: (() => void) | undefined;
/** Set by actions/index.ts so the built-ins register on first use (no import-time side effect to be tree-shaken). */
export function setDefaultRegistrar(fn: () => void) { ensureDefaults = fn; }

export function getAction(kind: StepKind): ActionAdapter {
  let a = registry.get(kind);
  if (!a && ensureDefaults) { ensureDefaults(); ensureDefaults = undefined; a = registry.get(kind); }
  if (!a) throw new Error(`no action adapter registered for kind "${kind}"`);
  return a;
}

export function listActions(): ActionAdapter[] {
  return [...registry.values()];
}
