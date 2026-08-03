import type { SolveStatus, SolveResult } from "../types.js";
import type { Var } from "./var.js";

/** The result of solving a Model. */
export class Solution {
  readonly status: SolveStatus;
  readonly objective?: number;
  private readonly values: Map<string, number>;

  /** @internal Use Model.solve() to obtain a Solution. */
  constructor(result: SolveResult) {
    this.status = result.status;
    this.objective = result.objective;
    this.values = result.solution ?? new Map();
  }

  /** Returns the value of a variable in the solution, or undefined if not found. */
  getValue(variable: Var): number | undefined {
    return this.values.get(variable.name);
  }
}
