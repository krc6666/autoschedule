import { loadHiGHSModule } from "./module.js";
import { HIGHS_INF } from "./types.js";
import type {
  EmscriptenModule,
  PrimalSolutionStatus,
  RawLinearObjective,
  RawModel,
  RawRows,
  SolverOptions,
  SolveResult,
  SolveStatus,
} from "./types.js";

const HIGHS_STATUS_MAP: Record<number, SolveStatus> = {
  0: "unknown", // kNotset
  1: "error", // kLoadError
  2: "error", // kModelError
  3: "error", // kPresolveError
  4: "error", // kSolveError
  5: "error", // kPostsolveError
  6: "error", // kModelEmpty
  7: "optimal", // kOptimal
  8: "infeasible", // kInfeasible
  9: "unboundedorinfeasible", // kUnboundedOrInfeasible
  10: "unbounded", // kUnbounded
  11: "objectivebound", // kObjectiveBound
  12: "objectivetarget", // kObjectiveTarget
  13: "timelimit", // kTimeLimit
  14: "iterationlimit", // kIterationLimit
  15: "unknown", // kUnknown
  16: "solutionlimit", // kSolutionLimit
  17: "unknown", // kInterrupt
  18: "unknown", // kMemoryLimit
  19: "unknown", // kHighsInterrupt
};

/** Low-level wrapper around the HiGHS optimization solver. */
export class HiGHS {
  private module: EmscriptenModule;
  private highsPtr: number;
  private freed = false;

  protected constructor(module: EmscriptenModule, highsPtr: number) {
    this.module = module;
    this.highsPtr = highsPtr;
  }

  /** Creates a new HiGHS solver instance. */
  static async create(options?: SolverOptions): Promise<HiGHS> {
    const module = await loadHiGHSModule(options);

    const highsPtr = module.ccall("Highs_create", "number", [], []) as number;
    if (highsPtr === 0) {
      throw new Error("Highs_create failed to create instance");
    }

    return new HiGHS(module, highsPtr);
  }

  /** Parses a problem from a string in the given format (e.g., 'lp', 'mps'). */
  async parse(content: string, format: string): Promise<void> {
    this.ensureNotFreed();

    const filename = `/tmp/problem.${format}`;
    this.module.FS.writeFile(filename, content);

    try {
      const status = this.module.ccall(
        "Highs_readModel",
        "number",
        ["number", "string"],
        [this.highsPtr, filename]
      ) as number;

      if (status !== 0) {
        throw new Error(`Highs_readModel failed with status ${status}`);
      }
    } finally {
      try {
        this.module.FS.unlink(filename);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Whether the loaded wasm build exports Highs_passLp/Highs_passMip, i.e.
   * whether passModel is available. Builds prior to 1.3.0 only support the
   * text-based parse path.
   */
  supportsPassModel(): boolean {
    const mod = this.module as unknown as Record<string, unknown>;
    return typeof mod._Highs_passLp === "function";
  }

  /**
   * Passes a problem in raw columnar form directly into solver memory via
   * Highs_passLp (or Highs_passMip when integrality is given), bypassing text
   * serialization and parsing entirely. For large models this is dramatically
   * faster than parse().
   */
  passModel(model: RawModel): void {
    this.ensureNotFreed();
    if (!this.supportsPassModel()) {
      throw new Error(
        "This wasm build does not export Highs_passLp — rebuild with 1.3.0+ or use parse()"
      );
    }

    const { numCol, numRow, matrix } = model;
    const rowwise = (matrix.format ?? "row") !== "col";
    const numNz = matrix.value.length;
    const startLen = (rowwise ? numRow : numCol) + 1;
    if (model.colCost.length !== numCol) {
      throw new Error(
        `colCost has ${model.colCost.length} entries, expected numCol = ${numCol}`
      );
    }
    if (matrix.start.length !== startLen) {
      throw new Error(
        `matrix.start has ${matrix.start.length} entries, expected ${startLen} for ${rowwise ? "row" : "col"}-wise layout`
      );
    }
    if (matrix.index.length !== numNz) {
      throw new Error(
        `matrix.index has ${matrix.index.length} entries, expected ${numNz} to match matrix.value`
      );
    }
    if (model.integrality && model.integrality.length !== numCol) {
      throw new Error(
        `integrality has ${model.integrality.length} entries, expected numCol = ${numCol}`
      );
    }

    const ptrs: number[] = [];
    const alloc = (bytes: number): number => {
      const ptr = this.module._malloc(Math.max(1, bytes));
      ptrs.push(ptr);
      return ptr;
    };
    // Views into wasm memory are created fresh for each copy: a later _malloc
    // may grow (and replace) the backing buffer, but growth preserves
    // contents, so copy-then-allocate is safe.
    const allocF64 = (
      data: Float64Array | number[] | undefined,
      len: number,
      fill: number
    ): number => {
      const ptr = alloc(len * 8);
      if (this.module.HEAPF64) {
        const view = new Float64Array(this.module.HEAPF64.buffer, ptr, len);
        if (data) view.set(data);
        else view.fill(fill);
      } else {
        for (let i = 0; i < len; i++)
          this.module.setValue(ptr + i * 8, data ? data[i] : fill, "double");
      }
      return ptr;
    };
    const allocI32 = (data: Int32Array | number[], len: number): number => {
      const ptr = alloc(len * 4);
      if (this.module.HEAP32) {
        new Int32Array(this.module.HEAP32.buffer, ptr, len).set(data);
      } else {
        for (let i = 0; i < len; i++)
          this.module.setValue(ptr + i * 4, data[i], "i32");
      }
      return ptr;
    };

    try {
      const args = [
        this.highsPtr,
        numCol,
        numRow,
        numNz,
        rowwise ? 2 : 1, // kHighsMatrixFormatRowwise / Colwise
        model.sense === "maximize" ? -1 : 1, // kHighsObjSenseMaximize / Minimize
        model.offset ?? 0,
        allocF64(model.colCost, numCol, 0),
        allocF64(model.colLower, numCol, 0),
        allocF64(model.colUpper, numCol, HIGHS_INF),
        allocF64(model.rowLower, numRow, -HIGHS_INF),
        allocF64(model.rowUpper, numRow, HIGHS_INF),
        allocI32(matrix.start, startLen),
        allocI32(matrix.index, numNz),
        allocF64(matrix.value, numNz, 0),
      ];
      let status: number;
      if (model.integrality) {
        args.push(allocI32(model.integrality, numCol));
        status = this.module.ccall(
          "Highs_passMip",
          "number",
          new Array(16).fill("number"),
          args
        ) as number;
      } else {
        status = this.module.ccall(
          "Highs_passLp",
          "number",
          new Array(15).fill("number"),
          args
        ) as number;
      }
      if (status !== 0) {
        throw new Error(
          `Highs_pass${model.integrality ? "Mip" : "Lp"} failed with status ${status}`
        );
      }
    } finally {
      for (const ptr of ptrs) this.module._free(ptr);
    }
  }

  /**
   * Returns the primal solution as a dense array indexed by column. This is
   * the natural readback for passModel-built problems, where columns have no
   * names, and avoids the per-column name lookups behind solve()'s Map.
   */
  getSolutionValues(): Float64Array {
    this.ensureNotFreed();

    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    ) as number;
    const out = new Float64Array(numCol);
    const ptr = this.module._malloc(Math.max(1, numCol * 8));
    try {
      this.module.ccall(
        "Highs_getSolution",
        "number",
        ["number", "number", "number", "number", "number"],
        [this.highsPtr, ptr, 0, 0, 0]
      );
      if (this.module.HEAPF64) {
        out.set(new Float64Array(this.module.HEAPF64.buffer, ptr, numCol));
      } else {
        for (let i = 0; i < numCol; i++)
          out[i] = this.module.getValue(ptr + i * 8, "double");
      }
    } finally {
      this.module._free(ptr);
    }
    return out;
  }

  changeObjective(
    coefficients: Float64Array | number[],
    direction: "minimize" | "maximize"
  ): void {
    this.ensureNotFreed();
    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    ) as number;
    if (coefficients.length !== numCol) {
      throw new Error(
        `objective has ${coefficients.length} entries, expected numCol = ${numCol}`
      );
    }
    const ptr = this.allocF64(coefficients);
    try {
      const costStatus = this.module.ccall(
        "Highs_changeColsCostByRange",
        "number",
        ["number", "number", "number", "number"],
        [this.highsPtr, 0, numCol - 1, ptr]
      ) as number;
      const senseStatus = this.module.ccall(
        "Highs_changeObjectiveSense",
        "number",
        ["number", "number"],
        [this.highsPtr, direction === "maximize" ? -1 : 1]
      ) as number;
      if (costStatus !== 0 || senseStatus !== 0) {
        throw new Error(
          `failed to change objective: cost=${costStatus}, sense=${senseStatus}`
        );
      }
    } finally {
      this.module._free(ptr);
    }
  }

  addRows(rows: RawRows): void {
    this.ensureNotFreed();
    const numRows = rows.lower.length;
    if (rows.upper.length !== numRows || rows.start.length !== numRows) {
      throw new Error("row bounds and starts must have matching lengths");
    }
    if (rows.index.length !== rows.value.length) {
      throw new Error("row index and value arrays must have matching lengths");
    }
    const ptrs = [
      this.allocF64(rows.lower),
      this.allocF64(rows.upper),
      this.allocI32(rows.start),
      this.allocI32(rows.index),
      this.allocF64(rows.value),
    ];
    try {
      const status = this.module.ccall(
        "Highs_addRows",
        "number",
        new Array(8).fill("number"),
        [
          this.highsPtr,
          numRows,
          ptrs[0],
          ptrs[1],
          rows.value.length,
          ptrs[2],
          ptrs[3],
          ptrs[4],
        ]
      ) as number;
      if (status !== 0)
        throw new Error(`Highs_addRows failed with status ${status}`);
    } finally {
      for (const ptr of ptrs) this.module._free(ptr);
    }
  }

  setSolutionValues(values: Float64Array | number[]): void {
    this.ensureNotFreed();
    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    ) as number;
    if (values.length !== numCol) {
      throw new Error(
        `solution has ${values.length} entries, expected numCol = ${numCol}`
      );
    }
    const ptr = this.allocF64(values);
    try {
      const status = this.module.ccall(
        "Highs_setSolution",
        "number",
        new Array(5).fill("number"),
        [this.highsPtr, ptr, 0, 0, 0]
      ) as number;
      if (status !== 0)
        throw new Error(`Highs_setSolution failed with status ${status}`);
    } finally {
      this.module._free(ptr);
    }
  }

  passLinearObjectives(objectives: readonly RawLinearObjective[]): void {
    this.ensureNotFreed();
    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    ) as number;
    for (const objective of objectives) {
      if (objective.coefficients.length !== numCol) {
        throw new Error(
          `objective has ${objective.coefficients.length} entries, expected numCol = ${numCol}`
        );
      }
    }
    const weights = objectives.map((objective) =>
      objective.direction === "maximize" ? -1 : 1
    );
    const coefficients = objectives.flatMap((objective) =>
      Array.from(objective.coefficients)
    );
    const ptrs = [
      this.allocF64(weights),
      this.allocF64(objectives.map((objective) => objective.offset ?? 0)),
      this.allocF64(coefficients),
      this.allocF64(objectives.map((objective) => objective.absTolerance ?? 0)),
      this.allocF64(objectives.map((objective) => objective.relTolerance ?? 0)),
      this.allocI32(objectives.map((objective) => objective.priority)),
    ];
    try {
      const status = this.module.ccall(
        "Highs_passLinearObjectives",
        "number",
        new Array(8).fill("number"),
        [this.highsPtr, objectives.length, ...ptrs]
      ) as number;
      if (status !== 0)
        throw new Error(
          `Highs_passLinearObjectives failed with status ${status}`
        );
    } finally {
      for (const ptr of ptrs) this.module._free(ptr);
    }
  }

  clearLinearObjectives(): void {
    this.ensureNotFreed();
    const status = this.module.ccall(
      "Highs_clearLinearObjectives",
      "number",
      ["number"],
      [this.highsPtr]
    ) as number;
    if (status !== 0)
      throw new Error(
        `Highs_clearLinearObjectives failed with status ${status}`
      );
  }

  /** Resets HiGHS' cumulative clocks before another run on this instance. */
  zeroAllClocks(): void {
    this.ensureNotFreed();
    const status = this.module.ccall(
      "Highs_zeroAllClocks",
      "number",
      ["number"],
      [this.highsPtr]
    ) as number;
    if (status !== 0)
      throw new Error(`Highs_zeroAllClocks failed with status ${status}`);
  }

  /** Sets a HiGHS option by name. Supports boolean, integer, real, and string values. */
  setParam(name: string, value: boolean | number | string): void {
    this.ensureNotFreed();

    if (typeof value === "boolean") {
      this.module.ccall(
        "Highs_setBoolOptionValue",
        "number",
        ["number", "string", "number"],
        [this.highsPtr, name, value ? 1 : 0]
      );
    } else if (typeof value === "string") {
      this.module.ccall(
        "Highs_setStringOptionValue",
        "number",
        ["number", "string", "string"],
        [this.highsPtr, name, value]
      );
    } else if (Number.isInteger(value)) {
      this.module.ccall(
        "Highs_setIntOptionValue",
        "number",
        ["number", "string", "number"],
        [this.highsPtr, name, value]
      );
    } else {
      this.module.ccall(
        "Highs_setDoubleOptionValue",
        "number",
        ["number", "string", "number"],
        [this.highsPtr, name, value]
      );
    }
  }

  /** Solves the loaded problem and returns the result. */
  async solve(): Promise<SolveResult> {
    this.ensureNotFreed();

    this.module.ccall("Highs_run", "number", ["number"], [this.highsPtr]);

    const statusCode = this.module.ccall(
      "Highs_getModelStatus",
      "number",
      ["number"],
      [this.highsPtr]
    ) as number;
    const status = HIGHS_STATUS_MAP[statusCode] ?? "unknown";

    const solutionStatus = this.primalSolutionStatus();
    const result: SolveResult = { status, solutionStatus };

    if (solutionStatus === "feasible") {
      result.mipGap = this.doubleInfoValue("mip_gap");
      result.mipDualBound = this.doubleInfoValue("mip_dual_bound");
      result.objective = this.module.ccall(
        "Highs_getObjectiveValue",
        "number",
        ["number"],
        [this.highsPtr]
      ) as number;

      result.solution = this.extractSolution();
    }

    return result;
  }

  private doubleInfoValue(name: string): number {
    const valuePtr = this.module._malloc(8);
    try {
      const status = this.module.ccall(
        "Highs_getDoubleInfoValue",
        "number",
        ["number", "string", "number"],
        [this.highsPtr, name, valuePtr]
      ) as number;
      if (status !== 0)
        throw new Error(
          `Highs_getDoubleInfoValue(${name}) failed with status ${status}`
        );
      return this.module.getValue(valuePtr, "double");
    } finally {
      this.module._free(valuePtr);
    }
  }

  private primalSolutionStatus(): PrimalSolutionStatus {
    const valuePtr = this.module._malloc(4);
    try {
      const status = this.module.ccall(
        "Highs_getIntInfoValue",
        "number",
        ["number", "string", "number"],
        [this.highsPtr, "primal_solution_status", valuePtr]
      ) as number;
      if (status !== 0)
        throw new Error(
          `Highs_getIntInfoValue(primal_solution_status) failed with status ${status}`
        );
      const value = this.module.getValue(valuePtr, "i32");
      if (value === 0) return "none";
      if (value === 1) return "infeasible";
      if (value === 2) return "feasible";
      throw new Error(`Unknown HiGHS primal solution status ${value}`);
    } finally {
      this.module._free(valuePtr);
    }
  }

  private extractSolution(): Map<string, number> {
    const solution = new Map<string, number>();

    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    ) as number;

    const colValuePtr = this.module._malloc(numCol * 8);
    try {
      this.module.ccall(
        "Highs_getSolution",
        "number",
        ["number", "number", "number", "number", "number"],
        [this.highsPtr, colValuePtr, 0, 0, 0]
      );

      const nameBufferSize = 256;
      const namePtr = this.module._malloc(nameBufferSize);
      try {
        for (let i = 0; i < numCol; i++) {
          const nameStatus = this.module.ccall(
            "Highs_getColName",
            "number",
            ["number", "number", "number"],
            [this.highsPtr, i, namePtr]
          ) as number;
          // Models passed via passModel have unnamed columns; fall back to a
          // positional name rather than decoding an untouched buffer.
          const name =
            nameStatus === 0 ? this.module.UTF8ToString(namePtr) : `col${i}`;
          const value = this.module.getValue(colValuePtr + i * 8, "double");
          solution.set(name, value);
        }
      } finally {
        this.module._free(namePtr);
      }
    } finally {
      this.module._free(colValuePtr);
    }

    return solution;
  }

  /** Frees the HiGHS instance. Safe to call multiple times. */
  free(): void {
    if (this.freed) {
      return;
    }

    this.freed = true;
    this.module.ccall("Highs_destroy", null, ["number"], [this.highsPtr]);
  }

  private ensureNotFreed(): void {
    if (this.freed) {
      throw new Error("HiGHS instance has been freed");
    }
  }

  private allocF64(data: Float64Array | number[]): number {
    const ptr = this.module._malloc(Math.max(1, data.length * 8));
    if (this.module.HEAPF64) {
      new Float64Array(this.module.HEAPF64.buffer, ptr, data.length).set(data);
    } else {
      for (let i = 0; i < data.length; i++)
        this.module.setValue(ptr + i * 8, data[i], "double");
    }
    return ptr;
  }

  private allocI32(data: Int32Array | number[]): number {
    const ptr = this.module._malloc(Math.max(1, data.length * 4));
    if (this.module.HEAP32) {
      new Int32Array(this.module.HEAP32.buffer, ptr, data.length).set(data);
    } else {
      for (let i = 0; i < data.length; i++)
        this.module.setValue(ptr + i * 4, data[i], "i32");
    }
    return ptr;
  }
}
