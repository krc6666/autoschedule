import { HiGHS as BaseHiGHS } from "../solver.js";
import type { SolverOptions } from "../types.js";
import { Var } from "./var.js";
import { LinExpr } from "./expr.js";
import { Constraint } from "./constraint.js";
import { Solution } from "./solution.js";
import { toLPFormat } from "./lp-format.js";
import { toMPSFormat } from "./mps-format.js";
import { exprBounds, isIntegral, assertBinary } from "./bounds.js";
import type {
  XorOptions,
  IndicatorOptions,
  BigMOptions,
  ReifyOptions,
} from "./types.js";
import { sum } from "./helpers.js";

function isBinary(v: Var): boolean {
  return (
    v.type === "binary" || (v.type === "integer" && v.lb === 0 && v.ub === 1)
  );
}

export type ModelFormat = "lp" | "mps";

/** High-level model builder for optimization problems. */
export class Model {
  private variables: Var[] = [];
  private constraints: Constraint[] = [];
  private objective: LinExpr | null = null;
  private sense: "minimize" | "maximize" = "minimize";
  private varCounter = 0;

  /** Creates a continuous variable with the given bounds and optional name. */
  numVar(lb = 0, ub = Infinity, name?: string): Var {
    const varName = name ?? `x${this.varCounter++}`;
    const v = new Var(varName, "continuous", lb, ub);
    this.variables.push(v);
    return v;
  }

  /** Creates an integer variable with the given bounds and optional name. */
  intVar(lb = 0, ub = Infinity, name?: string): Var {
    const varName = name ?? `x${this.varCounter++}`;
    const v = new Var(varName, "integer", lb, ub);
    this.variables.push(v);
    return v;
  }

  /** Creates a binary (0-1) variable with an optional name. */
  boolVar(name?: string): Var {
    const varName = name ?? `x${this.varCounter++}`;
    const v = new Var(varName, "binary", 0, 1);
    this.variables.push(v);
    return v;
  }

  /** Adds a constraint to the model with an optional name. */
  addConstraint(constraint: Constraint, name?: string): void {
    if (name !== undefined) constraint.name = name;
    this.constraints.push(constraint);
  }

  /** Sets the objective to minimize the given expression. */
  minimize(expr: LinExpr | Var): void {
    this.objective = expr instanceof Var ? expr.times(1) : expr;
    this.sense = "minimize";
  }

  /** Sets the objective to maximize the given expression. */
  maximize(expr: LinExpr | Var): void {
    this.objective = expr instanceof Var ? expr.times(1) : expr;
    this.sense = "maximize";
  }

  /** Returns a variable equal to the logical AND of the given binary variables. */
  and(...vars: Var[]): Var {
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
  or(...vars: Var[]): Var {
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
  not(x: Var): Var {
    assertBinary(x, "not()");

    const z = this.boolVar();
    this.addConstraint(z.plus(x).eq(1));
    return z;
  }

  /** Returns a variable equal to the XOR of two binary variables. */
  xor(x: Var, y: Var, options?: XorOptions): Var {
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
  addImplication(x: Var, y: Var): void {
    assertBinary(x, "addImplication()");
    assertBinary(y, "addImplication()");

    this.addConstraint(x.minus(y).leq(0));
  }

  /** Adds a cardinality constraint: at most k of the given variables are 1. */
  addAtMost(k: number, ...vars: Var[]): void {
    for (const v of vars) assertBinary(v, "addAtMost()");

    this.addConstraint(sum(...vars).leq(k));
  }

  /** Adds a cardinality constraint: at least k of the given variables are 1. */
  addAtLeast(k: number, ...vars: Var[]): void {
    for (const v of vars) assertBinary(v, "addAtLeast()");

    this.addConstraint(sum(...vars).geq(k));
  }

  /** Adds a cardinality constraint: exactly k of the given variables are 1. */
  addExactly(k: number, ...vars: Var[]): void {
    for (const v of vars) assertBinary(v, "addExactly()");

    this.addConstraint(sum(...vars).eq(k));
  }

  /**
   * Adds an indicator constraint: when delta equals the active value, the
   * given constraint is enforced via Big-M relaxation.
   */
  addIndicator(
    delta: Var,
    constraint: Constraint,
    options?: IndicatorOptions
  ): void {
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
  abs(expr: LinExpr | Var, options?: BigMOptions): Var {
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
  max(exprs: (LinExpr | Var)[], options?: BigMOptions): Var {
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
  min(exprs: (LinExpr | Var)[], options?: BigMOptions): Var {
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
  product(x: Var, y: Var, options?: BigMOptions): Var {
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
  semiContVar(lb: number, ub: number, name?: string): Var {
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
  divMod(expr: LinExpr | Var, d: number): { quotient: Var; remainder: Var } {
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
  addEitherOr(c1: Constraint, c2: Constraint, options?: BigMOptions): void {
    const delta = this.boolVar();
    this.addIndicator(delta, c1, { active: 0, bigM: options?.bigM });
    this.addIndicator(delta, c2, { active: 1, bigM: options?.bigM });
  }

  /**
   * Returns a binary variable delta where delta=1 iff the constraint is satisfied.
   * Supports <=, >=, and = senses.
   */
  reify(constraint: Constraint, options?: ReifyOptions): Var {
    const { expr, sense, rhs } = constraint;

    if (sense === "<=") {
      return this.reifyLeqInternal(expr, rhs, options);
    }
    if (sense === ">=") {
      return this.reifyLeqInternal(expr.neg(), -rhs, options);
    }

    return this.reifyEqInternal(expr, rhs, options);
  }

  private reifyLeqInternal(
    expr: LinExpr,
    rhs: number,
    options?: ReifyOptions
  ): Var {
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

  private reifyEqInternal(
    expr: LinExpr,
    rhs: number,
    options?: ReifyOptions
  ): Var {
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

  private defaultEpsilon(expr: LinExpr, rhs: number): number {
    return isIntegral(expr) && Number.isInteger(rhs) ? 1 : 1e-6;
  }

  private computeBigM(
    expr: LinExpr,
    rhs: number,
    sense: "<=" | ">=",
    context: string
  ): number {
    const { lb, ub } = this.finiteBounds(expr, context);
    return sense === "<=" ? ub - rhs : rhs - lb;
  }

  private finiteBounds(
    expr: LinExpr | Var,
    context: string
  ): { lb: number; ub: number } {
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
  print(format: ModelFormat = "lp"): string {
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
  async solve(options?: SolverOptions): Promise<Solution> {
    const mpsString = this.print("mps");
    const highs = await BaseHiGHS.create(options);
    try {
      await highs.parse(mpsString, "mps");
      const result = await highs.solve();
      return new Solution(result);
    } finally {
      highs.free();
    }
  }
}
