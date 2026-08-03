export interface DecisionVariable {
  id: string;
  type?: "binary" | "continuous";
  lowerBound?: number;
  upperBound?: number;
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
  solveOnlyWhen?: {
    objectiveId: string;
    equals: number;
    tolerance?: number;
  };
}

export interface SolverProblem {
  variables: readonly DecisionVariable[];
  constraints: readonly LinearConstraint[];
  objectives: readonly [LexicographicObjective, ...LexicographicObjective[]];
  timeoutMs: number;
  strategy?: "sequential" | "native-lexicographic";
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
