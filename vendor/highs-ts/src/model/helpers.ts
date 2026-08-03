import type { Var } from "./var.js";
import { LinExpr } from "./expr.js";

/** Returns the sum of the given variables, expressions, and constants. */
export function sum(...items: (Var | LinExpr | number)[]): LinExpr {
  let result = new LinExpr([], 0);
  for (const item of items) {
    result = result.plus(item);
  }
  return result;
}
