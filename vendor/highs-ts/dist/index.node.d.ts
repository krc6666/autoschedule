import { HiGHS as BaseHiGHS } from "./solver.js";
import type { SolverOptions } from "./types.js";
export { HIGHS_INF } from "./types.js";
export type {
  RawModel,
  SolverOptions,
  SolveResult,
  SolveStatus,
} from "./types.js";
export {
  Model,
  Var,
  LinExpr,
  Constraint,
  Solution,
  sum,
  exprBounds,
  isIntegral,
} from "./model/index.js";
export type {
  VarType,
  Sense,
  Term,
  ModelFormat,
  XorOptions,
  IndicatorOptions,
  BigMOptions,
  ReifyOptions,
} from "./model/index.js";
/** HiGHS solver with Node.js-specific file reading support. */
export declare class HiGHS extends BaseHiGHS {
  /** Reads a problem from a file path. The format is inferred from the extension. */
  readProblem(path: string): Promise<void>;
  static create(options?: SolverOptions): Promise<HiGHS>;
}
//# sourceMappingURL=index.node.d.ts.map
