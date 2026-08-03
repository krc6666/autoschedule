"use strict";

var fs = require("fs");

function wasmLocation() {
  const url = new URL(
    "../build/highs.wasm",
    require("url").pathToFileURL(__filename).href
  );
  if (typeof process !== "undefined" && process.versions?.node) {
    if (url.protocol !== "file:")
      return `${process.cwd().replace(/\\/g, "/")}/vendor/highs-ts/build/highs.wasm`;
  }
  if (url.protocol !== "file:") return url.href;
  const pathname = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
}
/** Loads a fresh HiGHS WebAssembly module with the given options. */
async function loadHiGHSModule(options) {
  const createModule = await loadHiGHSFactory();
  const consoleConfig = options?.console ?? { log: null, error: null };
  const moduleOptions = {
    print: consoleConfig.log ?? (() => {}),
    printErr: consoleConfig.error ?? (() => {}),
    locateFile: (path) => (path.endsWith(".wasm") ? wasmLocation() : path),
  };
  return createModule(moduleOptions);
}
async function loadHiGHSFactory() {
  // A static relative specifier keeps this import visible to consumers'
  // bundlers (webpack, vite, ...), which otherwise fail to include the
  // emscripten glue in their bundles. Our own rollup pass marks it external
  // so the specifier survives verbatim in the dist output.
  const { default: HiGHSModuleFactory } = await import("../build/highs.js");
  return HiGHSModuleFactory;
}

/** The value HiGHS treats as infinity in bounds. */
const HIGHS_INF = 1e30;

const HIGHS_STATUS_MAP = {
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
let HiGHS$1 = class HiGHS {
  constructor(module, highsPtr) {
    this.freed = false;
    this.module = module;
    this.highsPtr = highsPtr;
  }
  /** Creates a new HiGHS solver instance. */
  static async create(options) {
    const module = await loadHiGHSModule(options);
    const highsPtr = module.ccall("Highs_create", "number", [], []);
    if (highsPtr === 0) {
      throw new Error("Highs_create failed to create instance");
    }
    return new HiGHS(module, highsPtr);
  }
  /** Parses a problem from a string in the given format (e.g., 'lp', 'mps'). */
  async parse(content, format) {
    this.ensureNotFreed();
    const filename = `/tmp/problem.${format}`;
    this.module.FS.writeFile(filename, content);
    try {
      const status = this.module.ccall(
        "Highs_readModel",
        "number",
        ["number", "string"],
        [this.highsPtr, filename]
      );
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
  supportsPassModel() {
    const mod = this.module;
    return typeof mod._Highs_passLp === "function";
  }
  /**
   * Passes a problem in raw columnar form directly into solver memory via
   * Highs_passLp (or Highs_passMip when integrality is given), bypassing text
   * serialization and parsing entirely. For large models this is dramatically
   * faster than parse().
   */
  passModel(model) {
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
    const ptrs = [];
    const alloc = (bytes) => {
      const ptr = this.module._malloc(Math.max(1, bytes));
      ptrs.push(ptr);
      return ptr;
    };
    // Views into wasm memory are created fresh for each copy: a later _malloc
    // may grow (and replace) the backing buffer, but growth preserves
    // contents, so copy-then-allocate is safe.
    const allocF64 = (data, len, fill) => {
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
    const allocI32 = (data, len) => {
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
      let status;
      if (model.integrality) {
        args.push(allocI32(model.integrality, numCol));
        status = this.module.ccall(
          "Highs_passMip",
          "number",
          new Array(16).fill("number"),
          args
        );
      } else {
        status = this.module.ccall(
          "Highs_passLp",
          "number",
          new Array(15).fill("number"),
          args
        );
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
  getSolutionValues() {
    this.ensureNotFreed();
    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    );
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
  changeObjective(coefficients, direction) {
    this.ensureNotFreed();
    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    );
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
      );
      const senseStatus = this.module.ccall(
        "Highs_changeObjectiveSense",
        "number",
        ["number", "number"],
        [this.highsPtr, direction === "maximize" ? -1 : 1]
      );
      if (costStatus !== 0 || senseStatus !== 0) {
        throw new Error(
          `failed to change objective: cost=${costStatus}, sense=${senseStatus}`
        );
      }
    } finally {
      this.module._free(ptr);
    }
  }
  addRows(rows) {
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
      );
      if (status !== 0)
        throw new Error(`Highs_addRows failed with status ${status}`);
    } finally {
      for (const ptr of ptrs) this.module._free(ptr);
    }
  }
  setSolutionValues(values) {
    this.ensureNotFreed();
    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    );
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
      );
      if (status !== 0)
        throw new Error(`Highs_setSolution failed with status ${status}`);
    } finally {
      this.module._free(ptr);
    }
  }
  passLinearObjectives(objectives) {
    this.ensureNotFreed();
    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    );
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
      );
      if (status !== 0)
        throw new Error(
          `Highs_passLinearObjectives failed with status ${status}`
        );
    } finally {
      for (const ptr of ptrs) this.module._free(ptr);
    }
  }
  clearLinearObjectives() {
    this.ensureNotFreed();
    const status = this.module.ccall(
      "Highs_clearLinearObjectives",
      "number",
      ["number"],
      [this.highsPtr]
    );
    if (status !== 0)
      throw new Error(
        `Highs_clearLinearObjectives failed with status ${status}`
      );
  }
  /** Sets a HiGHS option by name. Supports boolean, integer, real, and string values. */
  setParam(name, value) {
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
  async solve() {
    this.ensureNotFreed();
    this.module.ccall("Highs_run", "number", ["number"], [this.highsPtr]);
    const statusCode = this.module.ccall(
      "Highs_getModelStatus",
      "number",
      ["number"],
      [this.highsPtr]
    );
    const status = HIGHS_STATUS_MAP[statusCode] ?? "unknown";
    const result = { status };
    if (
      status === "optimal" ||
      status === "timelimit" ||
      status === "solutionlimit" ||
      status === "objectivebound" ||
      status === "objectivetarget"
    ) {
      result.objective = this.module.ccall(
        "Highs_getObjectiveValue",
        "number",
        ["number"],
        [this.highsPtr]
      );
      result.solution = this.extractSolution();
    }
    return result;
  }
  extractSolution() {
    const solution = new Map();
    const numCol = this.module.ccall(
      "Highs_getNumCol",
      "number",
      ["number"],
      [this.highsPtr]
    );
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
          );
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
  free() {
    if (this.freed) {
      return;
    }
    this.freed = true;
    this.module.ccall("Highs_destroy", null, ["number"], [this.highsPtr]);
  }
  ensureNotFreed() {
    if (this.freed) {
      throw new Error("HiGHS instance has been freed");
    }
  }
  allocF64(data) {
    const ptr = this.module._malloc(Math.max(1, data.length * 8));
    if (this.module.HEAPF64) {
      new Float64Array(this.module.HEAPF64.buffer, ptr, data.length).set(data);
    } else {
      for (let i = 0; i < data.length; i++)
        this.module.setValue(ptr + i * 8, data[i], "double");
    }
    return ptr;
  }
  allocI32(data) {
    const ptr = this.module._malloc(Math.max(1, data.length * 4));
    if (this.module.HEAP32) {
      new Int32Array(this.module.HEAP32.buffer, ptr, data.length).set(data);
    } else {
      for (let i = 0; i < data.length; i++)
        this.module.setValue(ptr + i * 4, data[i], "i32");
    }
    return ptr;
  }
};

/** A linear constraint: expr sense rhs (e.g., x + y <= 10). */
class Constraint {
  /** @internal Use leq(), geq(), or eq() methods on expressions instead. */
  constructor(expr, sense, rhs, name) {
    this.expr = expr;
    this.sense = sense;
    this.rhs = rhs;
    this.name = name;
  }
}

/** A linear expression: sum of terms plus a constant. */
class LinExpr {
  /** @internal Use variable arithmetic methods (plus, minus, times) instead. */
  constructor(terms, constant) {
    this.terms = terms;
    this.constant = constant;
  }
  /** Returns this + other. */
  plus(other) {
    if (typeof other === "number") {
      return new LinExpr(this.terms, this.constant + other);
    }
    if (other instanceof LinExpr) {
      return new LinExpr(
        [...this.terms, ...other.terms],
        this.constant + other.constant
      );
    }
    return new LinExpr(
      [...this.terms, { coeff: 1, var: other }],
      this.constant
    );
  }
  /** Returns this - other. */
  minus(other) {
    if (typeof other === "number") {
      return new LinExpr(this.terms, this.constant - other);
    }
    if (other instanceof LinExpr) {
      const negatedTerms = other.terms.map((t) => ({
        coeff: -t.coeff,
        var: t.var,
      }));
      return new LinExpr(
        [...this.terms, ...negatedTerms],
        this.constant - other.constant
      );
    }
    return new LinExpr(
      [...this.terms, { coeff: -1, var: other }],
      this.constant
    );
  }
  /** Returns coeff * this. */
  times(coeff) {
    return new LinExpr(
      this.terms.map((t) => ({ coeff: t.coeff * coeff, var: t.var })),
      this.constant * coeff
    );
  }
  /** Returns -this. */
  neg() {
    return this.times(-1);
  }
  /** Returns a constraint: this <= rhs. */
  leq(rhs) {
    return new Constraint(this, "<=", rhs);
  }
  /** Returns a constraint: this >= rhs. */
  geq(rhs) {
    return new Constraint(this, ">=", rhs);
  }
  /** Returns a constraint: this == rhs. */
  eq(rhs) {
    return new Constraint(this, "=", rhs);
  }
}

/** A decision variable in an optimization model. */
class Var {
  /** @internal Use Model.numVar(), Model.intVar(), or Model.boolVar() instead. */
  constructor(name, type, lb, ub) {
    this.name = name;
    this.type = type;
    this.lb = lb;
    this.ub = ub;
  }
  toExpr() {
    return new LinExpr([{ coeff: 1, var: this }], 0);
  }
  /** Returns this + other. */
  plus(other) {
    return this.toExpr().plus(other);
  }
  /** Returns this - other. */
  minus(other) {
    return this.toExpr().minus(other);
  }
  /** Returns coeff * this. */
  times(coeff) {
    return new LinExpr([{ coeff, var: this }], 0);
  }
  /** Returns -this. */
  neg() {
    return this.times(-1);
  }
  /** Returns a constraint: this <= rhs. */
  leq(rhs) {
    return this.toExpr().leq(rhs);
  }
  /** Returns a constraint: this >= rhs. */
  geq(rhs) {
    return this.toExpr().geq(rhs);
  }
  /** Returns a constraint: this == rhs. */
  eq(rhs) {
    return this.toExpr().eq(rhs);
  }
}

/** The result of solving a Model. */
class Solution {
  /** @internal Use Model.solve() to obtain a Solution. */
  constructor(result) {
    this.status = result.status;
    this.objective = result.objective;
    this.values = result.solution ?? new Map();
  }
  /** Returns the value of a variable in the solution, or undefined if not found. */
  getValue(variable) {
    return this.values.get(variable.name);
  }
}

function toLPFormat(input) {
  const lines = [];
  if (input.sense === "maximize") {
    lines.push("Maximize");
  } else {
    lines.push("Minimize");
  }
  if (input.objective) {
    lines.push(`  obj: ${formatExpr(input.objective)}`);
  } else {
    lines.push("  obj: 0");
  }
  lines.push("Subject To");
  let constraintIndex = 0;
  for (const constraint of input.constraints) {
    const name = constraint.name ?? `c${constraintIndex++}`;
    const exprStr = formatExpr(constraint.expr);
    const senseStr = constraint.sense === "=" ? "=" : constraint.sense;
    const rhs = constraint.rhs - constraint.expr.constant;
    lines.push(`  ${name}: ${exprStr} ${senseStr} ${formatNumber(rhs)}`);
  }
  const boundsLines = [];
  const generalVars = [];
  const binaryVars = [];
  for (const v of input.variables) {
    if (v.type === "binary") {
      binaryVars.push(v.name);
    } else {
      if (v.type === "integer") {
        generalVars.push(v.name);
      }
      const hasNonDefaultBounds = v.lb !== 0 || v.ub !== Infinity;
      if (hasNonDefaultBounds) {
        if (v.ub === Infinity) {
          boundsLines.push(`  ${formatNumber(v.lb)} <= ${v.name}`);
        } else {
          boundsLines.push(
            `  ${formatNumber(v.lb)} <= ${v.name} <= ${formatNumber(v.ub)}`
          );
        }
      }
    }
  }
  if (boundsLines.length > 0) {
    lines.push("Bounds");
    lines.push(...boundsLines);
  }
  if (generalVars.length > 0) {
    lines.push("General");
    lines.push(`  ${generalVars.join(" ")}`);
  }
  if (binaryVars.length > 0) {
    lines.push("Binary");
    lines.push(`  ${binaryVars.join(" ")}`);
  }
  lines.push("End");
  return lines.join("\n") + "\n";
}
function formatExpr(expr) {
  const consolidated = consolidateTerms(expr);
  if (consolidated.length === 0) {
    return "0";
  }
  const parts = [];
  for (let i = 0; i < consolidated.length; i++) {
    const { coeff, varName } = consolidated[i];
    if (coeff === 0) continue;
    if (i === 0) {
      if (coeff === 1) {
        parts.push(varName);
      } else if (coeff === -1) {
        parts.push(`- ${varName}`);
      } else if (coeff < 0) {
        parts.push(`- ${formatNumber(-coeff)} ${varName}`);
      } else {
        parts.push(`${formatNumber(coeff)} ${varName}`);
      }
    } else {
      if (coeff === 1) {
        parts.push(`+ ${varName}`);
      } else if (coeff === -1) {
        parts.push(`- ${varName}`);
      } else if (coeff < 0) {
        parts.push(`- ${formatNumber(-coeff)} ${varName}`);
      } else {
        parts.push(`+ ${formatNumber(coeff)} ${varName}`);
      }
    }
  }
  return parts.join(" ") || "0";
}
function consolidateTerms(expr) {
  const coeffMap = new Map();
  for (const term of expr.terms) {
    const current = coeffMap.get(term.var.name) ?? 0;
    coeffMap.set(term.var.name, current + term.coeff);
  }
  const result = [];
  for (const [varName, coeff] of coeffMap) {
    if (coeff !== 0) {
      result.push({ coeff, varName });
    }
  }
  return result;
}
function formatNumber(n) {
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return n.toString();
}

/**
 * Converts a model to fixed MPS format. Uses the modern "free" MPS format
 * which doesn't require strict column alignment.
 */
function toMPSFormat(input) {
  const lines = [];
  const constraintNames = [];
  lines.push("NAME          problem");
  if (input.sense === "maximize") {
    lines.push("OBJSENSE");
    lines.push(" MAX");
  }
  // ROWS section: objective and constraints
  lines.push("ROWS");
  lines.push(" N  obj");
  let constraintIndex = 0;
  for (const constraint of input.constraints) {
    const name = constraint.name ?? `c${constraintIndex++}`;
    constraintNames.push(name);
    const rowType =
      constraint.sense === "<=" ? "L" : constraint.sense === ">=" ? "G" : "E";
    lines.push(` ${rowType}  ${name}`);
  }
  // COLUMNS section: variable coefficients
  lines.push("COLUMNS");
  // Build coefficient map: varName -> { rowName -> coeff }
  const varCoeffs = new Map();
  for (const v of input.variables) {
    varCoeffs.set(v.name, new Map());
  }
  // Add objective coefficients
  if (input.objective) {
    for (const term of input.objective.terms) {
      const coeffs = varCoeffs.get(term.var.name);
      const current = coeffs.get("obj") ?? 0;
      coeffs.set("obj", current + term.coeff);
    }
  }
  // Add constraint coefficients
  for (let i = 0; i < input.constraints.length; i++) {
    const constraint = input.constraints[i];
    const rowName = constraintNames[i];
    for (const term of constraint.expr.terms) {
      const coeffs = varCoeffs.get(term.var.name);
      const current = coeffs.get(rowName) ?? 0;
      coeffs.set(rowName, current + term.coeff);
    }
  }
  // Output columns, marking integer variables
  const integerVars = input.variables.filter(
    (v) => v.type === "integer" || v.type === "binary"
  );
  const continuousVars = input.variables.filter((v) => v.type === "continuous");
  // A variable with no nonzero coefficients would never be mentioned in
  // COLUMNS and so would not exist in the parsed model; an explicit zero
  // objective entry keeps it (and its solution value) alive.
  function pushColumn(v) {
    const coeffs = varCoeffs.get(v.name);
    let emitted = false;
    for (const [rowName, coeff] of coeffs) {
      if (coeff !== 0) {
        lines.push(`    ${v.name}  ${rowName}  ${coeff}`);
        emitted = true;
      }
    }
    if (!emitted) {
      lines.push(`    ${v.name}  obj  0`);
    }
  }
  for (const v of continuousVars) {
    pushColumn(v);
  }
  if (integerVars.length > 0) {
    lines.push("    MARKER    'MARKER'  'INTORG'");
    for (const v of integerVars) {
      pushColumn(v);
    }
    lines.push("    MARKER    'MARKER'  'INTEND'");
  }
  // RHS section
  lines.push("RHS");
  for (let i = 0; i < input.constraints.length; i++) {
    const constraint = input.constraints[i];
    const rowName = constraintNames[i];
    const rhs = constraint.rhs - constraint.expr.constant;
    if (rhs !== 0) {
      lines.push(`    rhs  ${rowName}  ${rhs}`);
    }
  }
  // BOUNDS section
  const hasBounds = input.variables.some(
    (v) => v.type !== "binary" && (v.lb !== 0 || v.ub !== Infinity)
  );
  const hasBinary = input.variables.some((v) => v.type === "binary");
  if (hasBounds || hasBinary) {
    lines.push("BOUNDS");
    for (const v of input.variables) {
      if (v.type === "binary") {
        lines.push(` BV bnd  ${v.name}`);
      } else {
        if (v.lb !== 0) {
          lines.push(` LO bnd  ${v.name}  ${v.lb}`);
        }
        if (v.ub !== Infinity) {
          lines.push(` UP bnd  ${v.name}  ${v.ub}`);
        } else if (v.lb === 0) {
          lines.push(` PL bnd  ${v.name}`);
        }
      }
    }
  }
  lines.push("ENDATA");
  return lines.join("\n") + "\n";
}

/** Computes tight lower and upper bounds on a linear expression from variable bounds. */
function exprBounds(expr) {
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
function isIntegral(expr) {
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
function assertBinary(v, context) {
  const isBinary =
    v.type === "binary" || (v.type === "integer" && v.lb === 0 && v.ub === 1);
  if (!isBinary) {
    throw new Error(`${context}: variable '${v.name}' must be binary`);
  }
}

/** Returns the sum of the given variables, expressions, and constants. */
function sum(...items) {
  let result = new LinExpr([], 0);
  for (const item of items) {
    result = result.plus(item);
  }
  return result;
}

function isBinary(v) {
  return (
    v.type === "binary" || (v.type === "integer" && v.lb === 0 && v.ub === 1)
  );
}
/** High-level model builder for optimization problems. */
class Model {
  constructor() {
    this.variables = [];
    this.constraints = [];
    this.objective = null;
    this.sense = "minimize";
    this.varCounter = 0;
  }
  /** Creates a continuous variable with the given bounds and optional name. */
  numVar(lb = 0, ub = Infinity, name) {
    const varName = name ?? `x${this.varCounter++}`;
    const v = new Var(varName, "continuous", lb, ub);
    this.variables.push(v);
    return v;
  }
  /** Creates an integer variable with the given bounds and optional name. */
  intVar(lb = 0, ub = Infinity, name) {
    const varName = name ?? `x${this.varCounter++}`;
    const v = new Var(varName, "integer", lb, ub);
    this.variables.push(v);
    return v;
  }
  /** Creates a binary (0-1) variable with an optional name. */
  boolVar(name) {
    const varName = name ?? `x${this.varCounter++}`;
    const v = new Var(varName, "binary", 0, 1);
    this.variables.push(v);
    return v;
  }
  /** Adds a constraint to the model with an optional name. */
  addConstraint(constraint, name) {
    if (name !== undefined) constraint.name = name;
    this.constraints.push(constraint);
  }
  /** Sets the objective to minimize the given expression. */
  minimize(expr) {
    this.objective = expr instanceof Var ? expr.times(1) : expr;
    this.sense = "minimize";
  }
  /** Sets the objective to maximize the given expression. */
  maximize(expr) {
    this.objective = expr instanceof Var ? expr.times(1) : expr;
    this.sense = "maximize";
  }
  /** Returns a variable equal to the logical AND of the given binary variables. */
  and(...vars) {
    if (vars.length === 0)
      throw new Error("and() requires at least 1 variable");
    if (vars.length === 1) return vars[0];
    for (const v of vars) assertBinary(v, "and()");
    const z = this.boolVar();
    for (const v of vars) this.addConstraint(z.minus(v).leq(0));
    this.addConstraint(
      sum(z, ...vars.map((v) => v.neg())).geq(1 - vars.length)
    );
    return z;
  }
  /** Returns a variable equal to the logical OR of the given binary variables. */
  or(...vars) {
    if (vars.length === 0) throw new Error("or() requires at least 1 variable");
    if (vars.length === 1) return vars[0];
    for (const v of vars) assertBinary(v, "or()");
    const z = this.boolVar();
    for (const v of vars) this.addConstraint(z.minus(v).geq(0));
    this.addConstraint(
      sum(...vars)
        .minus(z)
        .geq(0)
    );
    return z;
  }
  /** Returns a variable equal to the logical NOT of a binary variable. */
  not(x) {
    assertBinary(x, "not()");
    const z = this.boolVar();
    this.addConstraint(z.plus(x).eq(1));
    return z;
  }
  /** Returns a variable equal to the XOR of two binary variables. */
  xor(x, y, options) {
    assertBinary(x, "xor()");
    assertBinary(y, "xor()");
    const z = this.boolVar();
    if (options?.method === "compact") {
      const w = this.and(x, y);
      this.addConstraint(z.minus(x).minus(y).plus(w.times(2)).eq(0));
    } else {
      this.addConstraint(z.minus(x).minus(y).leq(0));
      this.addConstraint(z.minus(x).plus(y).geq(0));
      this.addConstraint(z.plus(x).minus(y).geq(0));
      this.addConstraint(z.plus(x).plus(y).leq(2));
    }
    return z;
  }
  /** Adds an implication constraint: x=1 implies y=1. */
  addImplication(x, y) {
    assertBinary(x, "addImplication()");
    assertBinary(y, "addImplication()");
    this.addConstraint(x.minus(y).leq(0));
  }
  /** Adds a cardinality constraint: at most k of the given variables are 1. */
  addAtMost(k, ...vars) {
    for (const v of vars) assertBinary(v, "addAtMost()");
    this.addConstraint(sum(...vars).leq(k));
  }
  /** Adds a cardinality constraint: at least k of the given variables are 1. */
  addAtLeast(k, ...vars) {
    for (const v of vars) assertBinary(v, "addAtLeast()");
    this.addConstraint(sum(...vars).geq(k));
  }
  /** Adds a cardinality constraint: exactly k of the given variables are 1. */
  addExactly(k, ...vars) {
    for (const v of vars) assertBinary(v, "addExactly()");
    this.addConstraint(sum(...vars).eq(k));
  }
  /**
   * Adds an indicator constraint: when delta equals the active value, the
   * given constraint is enforced via Big-M relaxation.
   */
  addIndicator(delta, constraint, options) {
    assertBinary(delta, "addIndicator()");
    const active = options?.active ?? 1;
    const { expr, sense, rhs } = constraint;
    if (sense === "<=" || sense === "=") {
      const M =
        options?.bigM ?? this.computeBigM(expr, rhs, "<=", "addIndicator()");
      if (active === 1) {
        this.addConstraint(expr.plus(delta.times(M)).leq(rhs + M));
      } else {
        this.addConstraint(expr.minus(delta.times(M)).leq(rhs));
      }
    }
    if (sense === ">=" || sense === "=") {
      const M =
        options?.bigM ?? this.computeBigM(expr, rhs, ">=", "addIndicator()");
      if (active === 1) {
        this.addConstraint(expr.minus(delta.times(M)).geq(rhs - M));
      } else {
        this.addConstraint(expr.plus(delta.times(M)).geq(rhs));
      }
    }
  }
  /**
   * Returns a variable equal to the absolute value of the given expression,
   * using sign decomposition with a boolean selector variable.
   */
  abs(expr, options) {
    const e = expr instanceof Var ? expr.times(1) : expr;
    const { lb: L, ub: U } =
      options?.bigM != null
        ? { lb: -options.bigM, ub: options.bigM }
        : this.finiteBounds(e, "abs()");
    const posMax = Math.max(U, 0);
    const negMax = Math.max(-L, 0);
    const xPlus = this.numVar(0, posMax);
    const xMinus = this.numVar(0, negMax);
    const delta = this.boolVar();
    const t = this.numVar(0, Math.max(posMax, negMax));
    this.addConstraint(e.minus(xPlus).plus(xMinus).eq(0));
    this.addConstraint(xPlus.plus(xMinus).minus(t).eq(0));
    this.addConstraint(xPlus.minus(delta.times(posMax)).leq(0));
    this.addConstraint(xMinus.plus(delta.times(negMax)).leq(negMax));
    return t;
  }
  /**
   * Returns a variable equal to the maximum of the given expressions, using
   * Big-M with boolean selectors.
   */
  max(exprs, options) {
    if (exprs.length === 0)
      throw new Error("max() requires at least 1 expression");
    if (exprs.length === 1) {
      const e = exprs[0];
      if (e instanceof Var) return e;
      const t = this.numVar(-Infinity, Infinity);
      this.addConstraint(e.minus(t).eq(0));
      return t;
    }
    const es = exprs.map((e) => (e instanceof Var ? e.times(1) : e));
    const bounds = es.map((e) =>
      options?.bigM != null
        ? { lb: -options.bigM, ub: options.bigM }
        : this.finiteBounds(e, "max()")
    );
    const maxUb = Math.max(...bounds.map((b) => b.ub));
    const minLb = Math.min(...bounds.map((b) => b.lb));
    const deltas = es.map(() => this.boolVar());
    const t = this.numVar(minLb, maxUb);
    for (let i = 0; i < es.length; i++) {
      const Mi = maxUb - bounds[i].lb;
      this.addConstraint(t.minus(es[i]).geq(0));
      this.addConstraint(t.minus(es[i]).plus(deltas[i].times(Mi)).leq(Mi));
    }
    this.addConstraint(sum(...deltas).eq(1));
    return t;
  }
  /**
   * Returns a variable equal to the minimum of the given expressions, using
   * Big-M with boolean selectors.
   */
  min(exprs, options) {
    if (exprs.length === 0)
      throw new Error("min() requires at least 1 expression");
    if (exprs.length === 1) {
      const e = exprs[0];
      if (e instanceof Var) return e;
      const t = this.numVar(-Infinity, Infinity);
      this.addConstraint(e.minus(t).eq(0));
      return t;
    }
    const es = exprs.map((e) => (e instanceof Var ? e.times(1) : e));
    const bounds = es.map((e) =>
      options?.bigM != null
        ? { lb: -options.bigM, ub: options.bigM }
        : this.finiteBounds(e, "min()")
    );
    const maxUb = Math.max(...bounds.map((b) => b.ub));
    const minLb = Math.min(...bounds.map((b) => b.lb));
    const t = this.numVar(minLb, maxUb);
    const deltas = es.map(() => this.boolVar());
    for (let i = 0; i < es.length; i++) {
      const Mi = bounds[i].ub - minLb;
      this.addConstraint(t.minus(es[i]).leq(0));
      this.addConstraint(t.minus(es[i]).minus(deltas[i].times(Mi)).geq(-Mi));
    }
    this.addConstraint(sum(...deltas).eq(1));
    return t;
  }
  /**
   * Returns a variable equal to the product of two variables. Automatically
   * selects the formulation based on variable types.
   */
  product(x, y, options) {
    const xBin = isBinary(x);
    const yBin = isBinary(y);
    if (xBin && yBin) {
      return this.and(x, y);
    }
    if (!xBin && !yBin) {
      throw new Error(
        "product() requires at least one binary variable; " +
          "for continuous*continuous use McCormick envelopes (not yet supported)"
      );
    }
    const [delta, z] = xBin ? [x, y] : [y, x];
    const { lb: L, ub: U } =
      options?.bigM != null
        ? { lb: -options.bigM, ub: options.bigM }
        : this.finiteBounds(z, "product()");
    const w = this.numVar(Math.min(L, 0), Math.max(U, 0));
    this.addConstraint(w.minus(delta.times(U)).leq(0));
    this.addConstraint(w.minus(delta.times(L)).geq(0));
    this.addConstraint(w.minus(z).minus(delta.times(L)).leq(-L));
    this.addConstraint(w.minus(z).minus(delta.times(U)).geq(-U));
    return w;
  }
  /**
   * Creates a semi-continuous variable that is either 0 or in [lb, ub].
   * Requires 0 < lb <= ub.
   */
  semiContVar(lb, ub, name) {
    if (lb <= 0 || ub < lb) {
      throw new Error("semiContVar(): requires 0 < lb <= ub");
    }
    const x = this.numVar(0, ub, name);
    const delta = this.boolVar();
    this.addConstraint(x.minus(delta.times(lb)).geq(0));
    this.addConstraint(x.minus(delta.times(ub)).leq(0));
    return x;
  }
  /**
   * Returns quotient and remainder variables for integer division of expr by d.
   * Requires expr >= 0 with finite upper bound, and d a positive integer.
   */
  divMod(expr, d) {
    if (!Number.isInteger(d) || d <= 0) {
      throw new Error("divMod(): d must be a positive integer");
    }
    const e = expr instanceof Var ? expr.times(1) : expr;
    const { lb, ub } = this.finiteBounds(e, "divMod()");
    if (lb < 0) {
      throw new Error("divMod(): expression must be non-negative");
    }
    const q = this.intVar(0, Math.floor(ub / d));
    const r = this.intVar(0, d - 1);
    this.addConstraint(e.minus(q.times(d)).minus(r).eq(0));
    return { quotient: q, remainder: r };
  }
  /** Enforces that at least one of the two constraints holds. */
  addEitherOr(c1, c2, options) {
    const delta = this.boolVar();
    this.addIndicator(delta, c1, { active: 0, bigM: options?.bigM });
    this.addIndicator(delta, c2, { active: 1, bigM: options?.bigM });
  }
  /**
   * Returns a binary variable delta where delta=1 iff the constraint is satisfied.
   * Supports <=, >=, and = senses.
   */
  reify(constraint, options) {
    const { expr, sense, rhs } = constraint;
    if (sense === "<=") {
      return this.reifyLeqInternal(expr, rhs, options);
    }
    if (sense === ">=") {
      return this.reifyLeqInternal(expr.neg(), -rhs, options);
    }
    return this.reifyEqInternal(expr, rhs, options);
  }
  reifyLeqInternal(expr, rhs, options) {
    const { lb, ub } =
      options?.bigM != null
        ? { lb: -options.bigM + rhs, ub: options.bigM + rhs }
        : this.finiteBounds(expr, "reify()");
    const M = ub - rhs;
    const m = lb - rhs;
    const eps = options?.epsilon ?? this.defaultEpsilon(expr, rhs);
    const delta = this.boolVar();
    this.addConstraint(expr.plus(delta.times(M)).leq(rhs + M));
    this.addConstraint(expr.minus(delta.times(m - eps)).geq(rhs + eps));
    return delta;
  }
  reifyEqInternal(expr, rhs, options) {
    const { lb, ub } =
      options?.bigM != null
        ? { lb: -options.bigM + rhs, ub: options.bigM + rhs }
        : this.finiteBounds(expr, "reify()");
    const Mpos = ub - rhs;
    const Mneg = rhs - lb;
    const M = Math.max(Mpos, Mneg);
    const eps = options?.epsilon ?? this.defaultEpsilon(expr, rhs);
    const delta = this.boolVar();
    const mu = this.boolVar();
    this.addConstraint(expr.plus(delta.times(M)).leq(rhs + M));
    this.addConstraint(expr.minus(delta.times(M)).geq(rhs - M));
    this.addConstraint(
      expr
        .plus(delta.times(M + eps))
        .plus(mu.times(M + eps))
        .geq(rhs + eps)
    );
    this.addConstraint(
      expr
        .minus(delta.times(M + eps))
        .plus(mu.times(M + eps))
        .leq(rhs - eps + (M + eps))
    );
    return delta;
  }
  defaultEpsilon(expr, rhs) {
    return isIntegral(expr) && Number.isInteger(rhs) ? 1 : 1e-6;
  }
  computeBigM(expr, rhs, sense, context) {
    const { lb, ub } = this.finiteBounds(expr, context);
    return sense === "<=" ? ub - rhs : rhs - lb;
  }
  finiteBounds(expr, context) {
    const b = exprBounds(expr);
    if (!isFinite(b.lb) || !isFinite(b.ub)) {
      throw new Error(
        `${context}: cannot auto-compute Big-M because expression has infinite bounds. ` +
          "Either bound all variables or provide an explicit { bigM } option."
      );
    }
    return b;
  }
  /** Prints the model in the specified format (defaults to LP). */
  print(format = "lp") {
    const input = {
      objective: this.objective,
      sense: this.sense,
      constraints: this.constraints,
      variables: this.variables,
    };
    return format === "mps" ? toMPSFormat(input) : toLPFormat(input);
  }
  /**
   * Solves the model and returns the solution. The model is passed to the
   * solver in MPS format rather than LP format, because the LP grammar
   * reserves characters that are perfectly legal in variable names here
   * (`+`, `-`, `[`, `]`, `:`, leading digits, ...) and the HiGHS LP reader
   * aborts on them, whereas MPS accepts any whitespace-free name.
   */
  async solve(options) {
    const mpsString = this.print("mps");
    const highs = await HiGHS$1.create(options);
    try {
      await highs.parse(mpsString, "mps");
      const result = await highs.solve();
      return new Solution(result);
    } finally {
      highs.free();
    }
  }
}

/** HiGHS solver with Node.js-specific file reading support. */
class HiGHS extends HiGHS$1 {
  /** Reads a problem from a file path. The format is inferred from the extension. */
  async readProblem(path) {
    const content = fs.readFileSync(path, "utf-8");
    const ext = path.split(".").pop() || "lp";
    await this.parse(content, ext);
  }
  static async create(options) {
    const base = await HiGHS$1.create(options);
    return Object.setPrototypeOf(base, HiGHS.prototype);
  }
}

exports.Constraint = Constraint;
exports.HIGHS_INF = HIGHS_INF;
exports.HiGHS = HiGHS;
exports.LinExpr = LinExpr;
exports.Model = Model;
exports.Solution = Solution;
exports.Var = Var;
exports.exprBounds = exprBounds;
exports.isIntegral = isIntegral;
exports.sum = sum;
//# sourceMappingURL=index.node.cjs.map
