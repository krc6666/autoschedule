import type {
  EmscriptenModule,
  RawLinearObjective,
  RawModel,
  RawRows,
  SolverOptions,
  SolveResult,
} from "./types.js";
/** Low-level wrapper around the HiGHS optimization solver. */
export declare class HiGHS {
  private module;
  private highsPtr;
  private freed;
  protected constructor(module: EmscriptenModule, highsPtr: number);
  /** Creates a new HiGHS solver instance. */
  static create(options?: SolverOptions): Promise<HiGHS>;
  /** Parses a problem from a string in the given format (e.g., 'lp', 'mps'). */
  parse(content: string, format: string): Promise<void>;
  /**
   * Whether the loaded wasm build exports Highs_passLp/Highs_passMip, i.e.
   * whether passModel is available. Builds prior to 1.3.0 only support the
   * text-based parse path.
   */
  supportsPassModel(): boolean;
  /**
   * Passes a problem in raw columnar form directly into solver memory via
   * Highs_passLp (or Highs_passMip when integrality is given), bypassing text
   * serialization and parsing entirely. For large models this is dramatically
   * faster than parse().
   */
  passModel(model: RawModel): void;
  /**
   * Returns the primal solution as a dense array indexed by column. This is
   * the natural readback for passModel-built problems, where columns have no
   * names, and avoids the per-column name lookups behind solve()'s Map.
   */
  getSolutionValues(): Float64Array;
  changeObjective(
    coefficients: Float64Array | number[],
    direction: "minimize" | "maximize"
  ): void;
  addRows(rows: RawRows): void;
  setSolutionValues(values: Float64Array | number[]): void;
  passLinearObjectives(objectives: readonly RawLinearObjective[]): void;
  clearLinearObjectives(): void;
  /** Resets HiGHS' cumulative clocks before another run on this instance. */
  zeroAllClocks(): void;
  /** Sets a HiGHS option by name. Supports boolean, integer, real, and string values. */
  setParam(name: string, value: boolean | number | string): void;
  /** Solves the loaded problem and returns the result. */
  solve(): Promise<SolveResult>;
  private doubleInfoValue;
  private primalSolutionStatus;
  private extractSolution;
  /** Frees the HiGHS instance. Safe to call multiple times. */
  free(): void;
  private ensureNotFreed;
  private allocF64;
  private allocI32;
}
//# sourceMappingURL=solver.d.ts.map
