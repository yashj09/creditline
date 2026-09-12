import { registerAction, setDefaultRegistrar } from "./registry.ts";
import { compoundRepay, compoundSupplyBorrow } from "./compound.ts";
import { cctpBurn, cctpRelay } from "./cctp.ts";
import { pay } from "./pay.ts";
import { markRepaid, scheduleRepayment } from "./repayment.ts";

export * from "./types.ts";
export * from "./registry.ts";
export * from "./compound.ts";
export * from "./cctp.ts";
export * from "./pay.ts";
export * from "./repayment.ts";

/** Built-in adapters. Called once on import of the SDK; third parties add theirs with `registerAction`. */
export function registerBuiltinActions(): void {
  for (const a of [compoundSupplyBorrow, compoundRepay, cctpBurn, cctpRelay, pay, scheduleRepayment, markRepaid]) registerAction(a);
}
setDefaultRegistrar(registerBuiltinActions);
