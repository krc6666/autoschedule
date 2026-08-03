import type { VarType } from "./types.js";
import { LinExpr } from "./expr.js";
import { Constraint } from "./constraint.js";

/** A decision variable in an optimization model. */
export class Var {
  readonly name: string;
  readonly type: VarType;
  readonly lb: number;
  readonly ub: number;

  /** @internal Use Model.numVar(), Model.intVar(), or Model.boolVar() instead. */
  constructor(name: string, type: VarType, lb: number, ub: number) {
    this.name = name;
    this.type = type;
    this.lb = lb;
    this.ub = ub;
  }

  private toExpr(): LinExpr {
    return new LinExpr([{ coeff: 1, var: this }], 0);
  }

  /** Returns this + other. */
  plus(other: Var | LinExpr | number): LinExpr {
    return this.toExpr().plus(other);
  }

  /** Returns this - other. */
  minus(other: Var | LinExpr | number): LinExpr {
    return this.toExpr().minus(other);
  }

  /** Returns coeff * this. */
  times(coeff: number): LinExpr {
    return new LinExpr([{ coeff, var: this }], 0);
  }

  /** Returns -this. */
  neg(): LinExpr {
    return this.times(-1);
  }

  /** Returns a constraint: this <= rhs. */
  leq(rhs: number): Constraint {
    return this.toExpr().leq(rhs);
  }

  /** Returns a constraint: this >= rhs. */
  geq(rhs: number): Constraint {
    return this.toExpr().geq(rhs);
  }

  /** Returns a constraint: this == rhs. */
  eq(rhs: number): Constraint {
    return this.toExpr().eq(rhs);
  }
}
