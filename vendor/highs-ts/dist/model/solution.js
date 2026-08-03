/** The result of solving a Model. */
export class Solution {
  /** @internal Use Model.solve() to obtain a Solution. */
  constructor(result) {
    this.status = result.status;
    this.objective = result.objective;
    this.values = result.solution ?? new Map();
  }
  /** Returns the value of a variable in the solution, or undefined if not found. */
  getValue(variable) {
    return this.values.get(variable.name);
  }
}
//# sourceMappingURL=solution.js.map
