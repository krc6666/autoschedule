import { LinExpr } from "./expr.js";
/** Returns the sum of the given variables, expressions, and constants. */
export function sum(...items) {
  let result = new LinExpr([], 0);
  for (const item of items) {
    result = result.plus(item);
  }
  return result;
}
//# sourceMappingURL=helpers.js.map
