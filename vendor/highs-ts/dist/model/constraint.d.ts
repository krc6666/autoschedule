import type { Sense } from "./types.js";
import type { LinExpr } from "./expr.js";
/** A linear constraint: expr sense rhs (e.g., x + y <= 10). */
export declare class Constraint {
  readonly expr: LinExpr;
  readonly sense: Sense;
  readonly rhs: number;
  name?: string;
  /** @internal Use leq(), geq(), or eq() methods on expressions instead. */
  constructor(expr: LinExpr, sense: Sense, rhs: number, name?: string);
}
//# sourceMappingURL=constraint.d.ts.map
