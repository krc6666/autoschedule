import { Var } from "./var.js";
/** Computes tight lower and upper bounds on a linear expression from variable bounds. */
export function exprBounds(expr) {
  if (expr instanceof Var) {
    return { lb: expr.lb, ub: expr.ub };
  }
  let lb = expr.constant;
  let ub = expr.constant;
  for (const term of expr.terms) {
    if (term.coeff > 0) {
      lb += term.coeff * term.var.lb;
      ub += term.coeff * term.var.ub;
    } else {
      lb += term.coeff * term.var.ub;
      ub += term.coeff * term.var.lb;
    }
  }
  return { lb, ub };
}
/** Returns true if the expression is guaranteed to take integer values. */
export function isIntegral(expr) {
  if (expr instanceof Var) {
    return expr.type === "integer" || expr.type === "binary";
  }
  if (!Number.isInteger(expr.constant)) return false;
  for (const term of expr.terms) {
    const varIsInt = term.var.type === "integer" || term.var.type === "binary";
    if (!varIsInt || !Number.isInteger(term.coeff)) return false;
  }
  return true;
}
/** @internal Validates that a variable is binary, throwing if not. */
export function assertBinary(v, context) {
  const isBinary =
    v.type === "binary" || (v.type === "integer" && v.lb === 0 && v.ub === 1);
  if (!isBinary) {
    throw new Error(`${context}: variable '${v.name}' must be binary`);
  }
}
//# sourceMappingURL=bounds.js.map
