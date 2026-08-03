/** The type of a decision variable. */
export type VarType = "continuous" | "integer" | "binary";

/** The sense of a constraint: <=, >=, or =. */
export type Sense = "<=" | ">=" | "=";

/** A term in a linear expression: coefficient * variable. */
export interface Term {
  coeff: number;
  var: Var;
}

import type { Var } from "./var.js";

export interface XorOptions {
  method?: "constraints" | "compact";
}

export interface IndicatorOptions {
  active?: 0 | 1;
  bigM?: number;
}

export interface BigMOptions {
  bigM?: number;
}

export interface ReifyOptions {
  bigM?: number;
  epsilon?: number;
}
