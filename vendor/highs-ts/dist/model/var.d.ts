import type { VarType } from "./types.js";
import { LinExpr } from "./expr.js";
import { Constraint } from "./constraint.js";
/** A decision variable in an optimization model. */
export declare class Var {
  readonly name: string;
  readonly type: VarType;
  readonly lb: number;
  readonly ub: number;
  /** @internal Use Model.numVar(), Model.intVar(), or Model.boolVar() instead. */
  constructor(name: string, type: VarType, lb: number, ub: number);
  private toExpr;
  /** Returns this + other. */
  plus(other: Var | LinExpr | number): LinExpr;
  /** Returns this - other. */
  minus(other: Var | LinExpr | number): LinExpr;
  /** Returns coeff * this. */
  times(coeff: number): LinExpr;
  /** Returns -this. */
  neg(): LinExpr;
  /** Returns a constraint: this <= rhs. */
  leq(rhs: number): Constraint;
  /** Returns a constraint: this >= rhs. */
  geq(rhs: number): Constraint;
  /** Returns a constraint: this == rhs. */
  eq(rhs: number): Constraint;
}
//# sourceMappingURL=var.d.ts.map
