/** A linear constraint: expr sense rhs (e.g., x + y <= 10). */
export class Constraint {
  /** @internal Use leq(), geq(), or eq() methods on expressions instead. */
  constructor(expr, sense, rhs, name) {
    this.expr = expr;
    this.sense = sense;
    this.rhs = rhs;
    this.name = name;
  }
}
//# sourceMappingURL=constraint.js.map
