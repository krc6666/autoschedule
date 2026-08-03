import { LinExpr } from "./expr.js";
import { Var } from "./var.js";
/** Computes tight lower and upper bounds on a linear expression from variable bounds. */
export declare function exprBounds(expr: LinExpr | Var): {
  lb: number;
  ub: number;
};
/** Returns true if the expression is guaranteed to take integer values. */
export declare function isIntegral(expr: LinExpr | Var): boolean;
/** @internal Validates that a variable is binary, throwing if not. */
export declare function assertBinary(v: Var, context: string): void;
//# sourceMappingURL=bounds.d.ts.map
