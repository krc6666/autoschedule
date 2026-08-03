import type { SolverOptions } from "../types.js";
import { Var } from "./var.js";
import { LinExpr } from "./expr.js";
import { Constraint } from "./constraint.js";
import { Solution } from "./solution.js";
import type {
  XorOptions,
  IndicatorOptions,
  BigMOptions,
  ReifyOptions,
} from "./types.js";
export type ModelFormat = "lp" | "mps";
/** High-level model builder for optimization problems. */
export declare class Model {
  private variables;
  private constraints;
  private objective;
  private sense;
  private varCounter;
  /** Creates a continuous variable with the given bounds and optional name. */
  numVar(lb?: number, ub?: number, name?: string): Var;
  /** Creates an integer variable with the given bounds and optional name. */
  intVar(lb?: number, ub?: number, name?: string): Var;
  /** Creates a binary (0-1) variable with an optional name. */
  boolVar(name?: string): Var;
  /** Adds a constraint to the model with an optional name. */
  addConstraint(constraint: Constraint, name?: string): void;
  /** Sets the objective to minimize the given expression. */
  minimize(expr: LinExpr | Var): void;
  /** Sets the objective to maximize the given expression. */
  maximize(expr: LinExpr | Var): void;
  /** Returns a variable equal to the logical AND of the given binary variables. */
  and(...vars: Var[]): Var;
  /** Returns a variable equal to the logical OR of the given binary variables. */
  or(...vars: Var[]): Var;
  /** Returns a variable equal to the logical NOT of a binary variable. */
  not(x: Var): Var;
  /** Returns a variable equal to the XOR of two binary variables. */
  xor(x: Var, y: Var, options?: XorOptions): Var;
  /** Adds an implication constraint: x=1 implies y=1. */
  addImplication(x: Var, y: Var): void;
  /** Adds a cardinality constraint: at most k of the given variables are 1. */
  addAtMost(k: number, ...vars: Var[]): void;
  /** Adds a cardinality constraint: at least k of the given variables are 1. */
  addAtLeast(k: number, ...vars: Var[]): void;
  /** Adds a cardinality constraint: exactly k of the given variables are 1. */
  addExactly(k: number, ...vars: Var[]): void;
  /**
   * Adds an indicator constraint: when delta equals the active value, the
   * given constraint is enforced via Big-M relaxation.
   */
  addIndicator(
    delta: Var,
    constraint: Constraint,
    options?: IndicatorOptions
  ): void;
  /**
   * Returns a variable equal to the absolute value of the given expression,
   * using sign decomposition with a boolean selector variable.
   */
  abs(expr: LinExpr | Var, options?: BigMOptions): Var;
  /**
   * Returns a variable equal to the maximum of the given expressions, using
   * Big-M with boolean selectors.
   */
  max(exprs: (LinExpr | Var)[], options?: BigMOptions): Var;
  /**
   * Returns a variable equal to the minimum of the given expressions, using
   * Big-M with boolean selectors.
   */
  min(exprs: (LinExpr | Var)[], options?: BigMOptions): Var;
  /**
   * Returns a variable equal to the product of two variables. Automatically
   * selects the formulation based on variable types.
   */
  product(x: Var, y: Var, options?: BigMOptions): Var;
  /**
   * Creates a semi-continuous variable that is either 0 or in [lb, ub].
   * Requires 0 < lb <= ub.
   */
  semiContVar(lb: number, ub: number, name?: string): Var;
  /**
   * Returns quotient and remainder variables for integer division of expr by d.
   * Requires expr >= 0 with finite upper bound, and d a positive integer.
   */
  divMod(
    expr: LinExpr | Var,
    d: number
  ): {
    quotient: Var;
    remainder: Var;
  };
  /** Enforces that at least one of the two constraints holds. */
  addEitherOr(c1: Constraint, c2: Constraint, options?: BigMOptions): void;
  /**
   * Returns a binary variable delta where delta=1 iff the constraint is satisfied.
   * Supports <=, >=, and = senses.
   */
  reify(constraint: Constraint, options?: ReifyOptions): Var;
  private reifyLeqInternal;
  private reifyEqInternal;
  private defaultEpsilon;
  private computeBigM;
  private finiteBounds;
  /** Prints the model in the specified format (defaults to LP). */
  print(format?: ModelFormat): string;
  /**
   * Solves the model and returns the solution. The model is passed to the
   * solver in MPS format rather than LP format, because the LP grammar
   * reserves characters that are perfectly legal in variable names here
   * (`+`, `-`, `[`, `]`, `:`, leading digits, ...) and the HiGHS LP reader
   * aborts on them, whereas MPS accepts any whitespace-free name.
   */
  solve(options?: SolverOptions): Promise<Solution>;
}
//# sourceMappingURL=model.d.ts.map
