export interface DecisionVariable {
  id: string;
  type?: "binary" | "continuous";
  lowerBound?: number;
  upperBound?: number;
  /** The variable can be safely tightened to its base-constraint lower envelope. */
  lowerEnvelope?: true;
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
  /** Defaults to required when omitted by shared solver callers. */
  optimality?: "required" | "best-effort";
  /** Proven minimum distance between distinct feasible objective values. */
  objectiveValueStep?: number;
  /** Product-approved optimality gap for a best-effort objective. */
  acceptedGap?: {
    relative?: number;
    absolute?: number;
  };
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
  | "optimal"
  | "gap-limited-feasible"
  | "time-limited-feasible"
  | "infeasible"
  | "timed-out"
  | "failed";

export interface BestEffortSolveDetails {
  stoppedAtObjectiveId: string;
  completedObjectiveIds: readonly string[];
  solutionSource: "current-incumbent" | "previous-optimal";
}

export interface SolverResult {
  termination: SolverTermination;
  selectedVariableIds: ReadonlySet<string>;
  objectiveValues: ReadonlyMap<string, number>;
  bestEffort?: BestEffortSolveDetails;
  approximatedObjectiveIds?: readonly string[];
  diagnostic?: string;
}

export interface SolverPort {
  solve(
    problem: SolverProblem,
    options?: {
      onRequiredSolution?: (result: SolverResult) => void;
      onBestEffortSolution?: (result: SolverResult) => void;
    }
  ): Promise<SolverResult>;
}
