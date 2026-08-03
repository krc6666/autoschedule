import { LinExpr } from "./expr.js";
/** A decision variable in an optimization model. */
export class Var {
  /** @internal Use Model.numVar(), Model.intVar(), or Model.boolVar() instead. */
  constructor(name, type, lb, ub) {
    this.name = name;
    this.type = type;
    this.lb = lb;
    this.ub = ub;
  }
  toExpr() {
    return new LinExpr([{ coeff: 1, var: this }], 0);
  }
  /** Returns this + other. */
  plus(other) {
    return this.toExpr().plus(other);
  }
  /** Returns this - other. */
  minus(other) {
    return this.toExpr().minus(other);
  }
  /** Returns coeff * this. */
  times(coeff) {
    return new LinExpr([{ coeff, var: this }], 0);
  }
  /** Returns -this. */
  neg() {
    return this.times(-1);
  }
  /** Returns a constraint: this <= rhs. */
  leq(rhs) {
    return this.toExpr().leq(rhs);
  }
  /** Returns a constraint: this >= rhs. */
  geq(rhs) {
    return this.toExpr().geq(rhs);
  }
  /** Returns a constraint: this == rhs. */
  eq(rhs) {
    return this.toExpr().eq(rhs);
  }
}
//# sourceMappingURL=var.js.map
