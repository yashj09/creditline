import type { ActionAdapter } from "./types.ts";
import type { StepKind } from "../plan/schema.ts";

const registry = new Map<string, ActionAdapter>();

/** Register (or override) an adapter. Third parties call this to add their protocol. */
export function registerAction(adapter: ActionAdapter): void {
  registry.set(adapter.kind, adapter);
}

export function getAction(kind: StepKind): ActionAdapter {
  const a = registry.get(kind);
  if (!a) throw new Error(`no action adapter registered for kind "${kind}"`);
  return a;
}

export function listActions(): ActionAdapter[] {
  return [...registry.values()];
}
