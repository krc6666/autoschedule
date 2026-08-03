import type { Term } from "./types.js";
import type { Var } from "./var.js";
import { Constraint } from "./constraint.js";
/** A linear expression: sum of terms plus a constant. */
export declare class LinExpr {
  readonly terms: Term[];
  readonly constant: number;
  /** @internal Use variable arithmetic methods (plus, minus, times) instead. */
  constructor(terms: Term[], constant: number);
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
//# sourceMappingURL=expr.d.ts.map
