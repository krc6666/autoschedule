/** Status returned by HiGHS after solving a problem. */
export type SolveStatus =
  | "optimal"
  | "infeasible"
  | "unbounded"
  | "unboundedorinfeasible"
  | "timelimit"
  | "iterationlimit"
  | "solutionlimit"
  | "objectivebound"
  | "objectivetarget"
  | "error"
  | "unknown";
/** Official HiGHS primal solution status. */
export type PrimalSolutionStatus = "none" | "infeasible" | "feasible";
/** Result of solving an optimization problem. */
export interface SolveResult {
  status: SolveStatus;
  solutionStatus: PrimalSolutionStatus;
  /** Official HiGHS relative MIP gap for the completed run. */
  mipGap?: number;
  /** Official HiGHS MIP dual bound for the completed run. */
  mipDualBound?: number;
  objective?: number;
  solution?: Map<string, number>;
}
/** Console output configuration for the HiGHS module. */
export interface ConsoleOptions {
  /** Handler for stdout messages. Set to null to suppress. */
  log?: ((text: string) => void) | null;
  /** Handler for stderr messages. Set to null to suppress. */
  error?: ((text: string) => void) | null;
}
/** Options for HiGHS instance creation. */
export interface SolverOptions {
  /** Configure console output handling. */
  console?: ConsoleOptions;
}
/** The value HiGHS treats as infinity in bounds. */
export declare const HIGHS_INF = 1e30;
/**
 * A problem in raw columnar form, passed to the solver without any text
 * serialization or parsing. This is the fast path for large models: typed
 * arrays go straight into solver memory via Highs_passLp/Highs_passMip.
 *
 * The constraint matrix is sparse in either row-wise (default) or column-wise
 * layout: `start[k]` is the offset of row/column k's entries in `index` and
 * `value`, with `start[numRow]` (resp. `start[numCol]`) equal to the number
 * of non-zeros.
 */
export interface RawModel {
  numCol: number;
  numRow: number;
  /** Defaults to 'minimize'. */
  sense?: "minimize" | "maximize";
  /** Constant offset added to the objective. Defaults to 0. */
  offset?: number;
  colCost: Float64Array | number[];
  /** Defaults to 0 for every column. */
  colLower?: Float64Array | number[];
  /** Defaults to +infinity for every column. */
  colUpper?: Float64Array | number[];
  /** Defaults to -infinity for every row. */
  rowLower?: Float64Array | number[];
  /** Defaults to +infinity for every row. */
  rowUpper?: Float64Array | number[];
  matrix: {
    /** Sparse layout of `start`. Defaults to 'row'. */
    format?: "row" | "col";
    start: Int32Array | number[];
    index: Int32Array | number[];
    value: Float64Array | number[];
  };
  /**
   * Per-column variable types (0 = continuous, 1 = integer). When present the
   * model is passed as a MIP via Highs_passMip.
   */
  integrality?: Int32Array | number[];
}
export interface RawLinearObjective {
  direction: "minimize" | "maximize";
  coefficients: Float64Array | number[];
  offset?: number;
  absTolerance?: number;
  relTolerance?: number;
  priority: number;
}
export interface RawRows {
  lower: Float64Array | number[];
  upper: Float64Array | number[];
  start: Int32Array | number[];
  index: Int32Array | number[];
  value: Float64Array | number[];
}
/** The Emscripten module interface exposed by the compiled HiGHS WebAssembly. */
export interface EmscriptenModule {
  ccall: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => unknown;
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[]
  ) => (...args: unknown[]) => unknown;
  getValue: (ptr: number, type: string) => number;
  setValue: (ptr: number, value: number, type: string) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, ptr: number, maxBytes: number) => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  /** Present when the wasm build exports HEAPF64 (1.3.0+). */
  HEAPF64?: Float64Array;
  HEAP32?: Int32Array;
  FS: {
    writeFile: (path: string, data: string | Uint8Array) => void;
    readFile: (
      path: string,
      opts?: {
        encoding?: string;
      }
    ) => string | Uint8Array;
    unlink: (path: string) => void;
    mkdir: (path: string) => void;
  };
}
/** Factory function that creates the Emscripten HiGHS module. */
export type HiGHSModuleFactory = (
  options?: Record<string, unknown>
) => Promise<EmscriptenModule>;
//# sourceMappingURL=types.d.ts.map
