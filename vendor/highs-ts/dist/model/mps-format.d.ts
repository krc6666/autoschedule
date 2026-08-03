import type { Var } from "./var.js";
import type { LinExpr } from "./expr.js";
import type { Constraint } from "./constraint.js";
export interface MPSFormatInput {
  objective: LinExpr | null;
  sense: "minimize" | "maximize";
  constraints: Constraint[];
  variables: Var[];
}
/**
 * Converts a model to fixed MPS format. Uses the modern "free" MPS format
 * which doesn't require strict column alignment.
 */
export declare function toMPSFormat(input: MPSFormatInput): string;
//# sourceMappingURL=mps-format.d.ts.map
