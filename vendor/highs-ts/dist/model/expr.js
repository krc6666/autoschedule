import { Constraint } from "./constraint.js";
/** A linear expression: sum of terms plus a constant. */
export class LinExpr {
  /** @internal Use variable arithmetic methods (plus, minus, times) instead. */
  constructor(terms, constant) {
    this.terms = terms;
    this.constant = constant;
  }
  /** Returns this + other. */
  plus(other) {
    if (typeof other === "number") {
      return new LinExpr(this.terms, this.constant + other);
    }
    if (other instanceof LinExpr) {
      return new LinExpr(
        [...this.terms, ...other.terms],
        this.constant + other.constant
      );
    }
    return new LinExpr(
      [...this.terms, { coeff: 1, var: other }],
      this.constant
    );
  }
  /** Returns this - other. */
  minus(other) {
    if (typeof other === "number") {
      return new LinExpr(this.terms, this.constant - other);
    }
    if (other instanceof LinExpr) {
      const negatedTerms = other.terms.map((t) => ({
        coeff: -t.coeff,
        var: t.var,
      }));
      return new LinExpr(
        [...this.terms, ...negatedTerms],
        this.constant - other.constant
      );
    }
    return new LinExpr(
      [...this.terms, { coeff: -1, var: other }],
      this.constant
    );
  }
  /** Returns coeff * this. */
  times(coeff) {
    return new LinExpr(
      this.terms.map((t) => ({ coeff: t.coeff * coeff, var: t.var })),
      this.constant * coeff
    );
  }
  /** Returns -this. */
  neg() {
    return this.times(-1);
  }
  /** Returns a constraint: this <= rhs. */
  leq(rhs) {
    return new Constraint(this, "<=", rhs);
  }
  /** Returns a constraint: this >= rhs. */
  geq(rhs) {
    return new Constraint(this, ">=", rhs);
  }
  /** Returns a constraint: this == rhs. */
  eq(rhs) {
    return new Constraint(this, "=", rhs);
  }
}
//# sourceMappingURL=expr.js.map
