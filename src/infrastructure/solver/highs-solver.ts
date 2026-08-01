import {
  HIGHS_INF,
  HiGHS,
  type RawModel,
  type SolveStatus,
} from "@bubblyworld/highs-ts";

import type {
  LexicographicObjective,
  LinearConstraint,
  SolverPort,
  SolverProblem,
  SolverResult,
} from "../../domain/solver/solver-port";

interface LockedObjective {
  objective: LexicographicObjective;
  value: number;
}

function solverTermination(status: SolveStatus): SolverResult["termination"] {
  if (status === "optimal") return "optimal";
  if (status === "infeasible" || status === "unboundedorinfeasible")
    return "infeasible";
  if (
    status === "timelimit" ||
    status === "iterationlimit" ||
    status === "solutionlimit"
  )
    return "timed-out";
  return "failed";
}

function objectiveValue(
  objective: LexicographicObjective,
  values: Float64Array,
  columnById: ReadonlyMap<string, number>
): number {
  const value = objective.terms.reduce(
    (total, term) =>
      total + term.coefficient * values[columnById.get(term.variableId)!]!,
    0
  );
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(12));
}

function rawModel(
  problem: SolverProblem,
  objective: LexicographicObjective,
  locks: readonly LockedObjective[]
): RawModel {
  const columnById = new Map(
    problem.variables.map((variable, index) => [variable.id, index])
  );
  const constraints: LinearConstraint[] = [
    ...problem.constraints,
    ...locks.map(({ objective: locked, value }) => ({
      id: `lock:${locked.id}`,
      terms: locked.terms,
      lowerBound: value,
      upperBound: value,
    })),
  ];
  const starts: number[] = [0];
  const indices: number[] = [];
  const coefficients: number[] = [];
  for (const constraint of constraints) {
    for (const term of constraint.terms) {
      const column = columnById.get(term.variableId);
      if (column === undefined)
        throw new Error(
          `求解约束 ${constraint.id} 引用了未知变量 ${term.variableId}`
        );
      indices.push(column);
      coefficients.push(term.coefficient);
    }
    starts.push(indices.length);
  }
  const costs = new Float64Array(problem.variables.length);
  for (const term of objective.terms) {
    const column = columnById.get(term.variableId);
    if (column === undefined)
      throw new Error(
        `求解目标 ${objective.id} 引用了未知变量 ${term.variableId}`
      );
    costs[column] = costs[column]! + term.coefficient;
  }
  return {
    numCol: problem.variables.length,
    numRow: constraints.length,
    sense: objective.direction,
    colCost: costs,
    colUpper: new Float64Array(problem.variables.length).fill(1),
    rowLower: Float64Array.from(
      constraints.map((constraint) => constraint.lowerBound ?? -HIGHS_INF)
    ),
    rowUpper: Float64Array.from(
      constraints.map((constraint) => constraint.upperBound ?? HIGHS_INF)
    ),
    matrix: {
      format: "row",
      start: Int32Array.from(starts),
      index: Int32Array.from(indices),
      value: Float64Array.from(coefficients),
    },
    integrality: new Int32Array(problem.variables.length).fill(1),
  };
}

function validateProblem(problem: SolverProblem): void {
  if (!problem.variables.length) throw new Error("求解任务没有决策变量");
  if (!Number.isFinite(problem.timeoutMs) || problem.timeoutMs <= 0)
    throw new Error("求解超时必须大于 0 毫秒");
  const ids = new Set<string>();
  for (const variable of problem.variables) {
    if (!variable.id) throw new Error("求解变量缺少 ID");
    if (ids.has(variable.id))
      throw new Error(`求解变量 ID 重复：${variable.id}`);
    ids.add(variable.id);
  }
}

export class HighsSolver implements SolverPort {
  private instance?: Promise<HiGHS>;
  private queue: Promise<void> = Promise.resolve();

  solve(problem: SolverProblem): Promise<SolverResult> {
    const pending = this.queue.then(
      () => this.solveExclusive(problem),
      () => this.solveExclusive(problem)
    );
    this.queue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private async solveExclusive(problem: SolverProblem): Promise<SolverResult> {
    validateProblem(problem);
    this.instance ??= HiGHS.create();
    const highs = await this.instance;
    const deadline = Date.now() + problem.timeoutMs;
    const locks: LockedObjective[] = [];
    const objectiveValues = new Map<string, number>();
    let finalValues: Float64Array = new Float64Array(problem.variables.length);
    const columnById = new Map(
      problem.variables.map((variable, index) => [variable.id, index])
    );

    for (const objective of problem.objectives) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return {
          termination: "timed-out",
          selectedVariableIds: new Set(),
          objectiveValues,
          diagnostic: `求解目标 ${objective.id} 前已达到时间上限`,
        };
      }
      highs.setParam("time_limit", remainingMs / 1000);
      highs.setParam("mip_rel_gap", 0);
      highs.setParam("random_seed", 0);
      highs.setParam("output_flag", false);
      highs.passModel(rawModel(problem, objective, locks));
      const result = await highs.solve();
      const termination = solverTermination(result.status);
      if (termination !== "optimal") {
        return {
          termination,
          selectedVariableIds: new Set(),
          objectiveValues,
          diagnostic: `求解目标 ${objective.id} 结束状态：${result.status}`,
        };
      }
      finalValues = highs.getSolutionValues();
      const value = objectiveValue(objective, finalValues, columnById);
      objectiveValues.set(objective.id, value);
      locks.push({ objective, value });
    }

    return {
      termination: "optimal",
      selectedVariableIds: new Set(
        problem.variables.flatMap((variable, index) =>
          finalValues[index]! > 0.5 ? [variable.id] : []
        )
      ),
      objectiveValues,
    };
  }
}

export const defaultHighsSolver: SolverPort = new HighsSolver();
