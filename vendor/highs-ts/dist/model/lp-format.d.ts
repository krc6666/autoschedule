import type { Var } from "./var.js";
import type { LinExpr } from "./expr.js";
import type { Constraint } from "./constraint.js";
export interface LPFormatInput {
  objective: LinExpr | null;
  sense: "minimize" | "maximize";
  constraints: Constraint[];
  variables: Var[];
}
export declare function toLPFormat(input: LPFormatInput): string;
//# sourceMappingURL=lp-format.d.ts.map
