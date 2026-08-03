import type { SolveStatus, SolveResult } from "../types.js";
import type { Var } from "./var.js";
/** The result of solving a Model. */
export declare class Solution {
  readonly status: SolveStatus;
  readonly objective?: number;
  private readonly values;
  /** @internal Use Model.solve() to obtain a Solution. */
  constructor(result: SolveResult);
  /** Returns the value of a variable in the solution, or undefined if not found. */
  getValue(variable: Var): number | undefined;
}
//# sourceMappingURL=solution.d.ts.map
