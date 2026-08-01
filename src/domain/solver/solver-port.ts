export interface BinaryDecisionVariable {
  id: string;
}

export interface LinearTerm {
  variableId: string;
  coefficient: number;
}

export interface LinearConstraint {
  id: string;
  terms: readonly LinearTerm[];
  lowerBound?: number;
  upperBound?: number;
}

export interface LexicographicObjective {
  id: string;
  direction: "minimize" | "maximize";
  terms: readonly LinearTerm[];
}

export interface SolverProblem {
  variables: readonly BinaryDecisionVariable[];
  constraints: readonly LinearConstraint[];
  objectives: readonly [LexicographicObjective, ...LexicographicObjective[]];
  timeoutMs: number;
}

export type SolverTermination =
  "optimal" | "infeasible" | "timed-out" | "failed";

export interface SolverResult {
  termination: SolverTermination;
  selectedVariableIds: ReadonlySet<string>;
  objectiveValues: ReadonlyMap<string, number>;
  diagnostic?: string;
}

export interface SolverPort {
  solve(problem: SolverProblem): Promise<SolverResult>;
}
