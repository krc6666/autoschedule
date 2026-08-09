import {
  HIGHS_INF,
  HiGHS,
  type RawModel,
  type SolveStatus,
} from "@bubblyworld/highs-ts";
import { HiGHS as NativeHiGHS } from "@autoschedule/highs-ts";

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

const OBJECTIVE_LOCK_TOLERANCE = 1e-7;

function objectiveLockConstraint({
  objective,
  value,
}: LockedObjective): LinearConstraint {
  const tolerance = OBJECTIVE_LOCK_TOLERANCE * Math.max(1, Math.abs(value));
  return {
    id: `lock:${objective.id}`,
    terms: objective.terms,
    ...(objective.direction === "minimize"
      ? { upperBound: value + tolerance }
      : { lowerBound: value - tolerance }),
  };
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
  columnById: ReadonlyMap<string, number>,
  integralVariableIds: ReadonlySet<string>
): number {
  const value = objective.terms.reduce(
    (total, term) =>
      total + term.coefficient * values[columnById.get(term.variableId)!]!,
    0
  );
  if (
    objective.terms.every(
      (term) =>
        Number.isInteger(term.coefficient) &&
        integralVariableIds.has(term.variableId)
    )
  )
    return Math.round(value);
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(12));
}

function shouldSolveObjective(
  objective: LexicographicObjective,
  objectiveValues: ReadonlyMap<string, number>
): boolean {
  if (!objective.solveOnlyWhen) return true;
  const priorValue = objectiveValues.get(objective.solveOnlyWhen.objectiveId);
  if (priorValue === undefined)
    throw new Error(
      `条件目标 ${objective.id} 引用了尚未求解的目标 ${objective.solveOnlyWhen.objectiveId}`
    );
  return (
    Math.abs(priorValue - objective.solveOnlyWhen.equals) <=
    (objective.solveOnlyWhen.tolerance ?? OBJECTIVE_LOCK_TOLERANCE)
  );
}

function objectiveCosts(
  problem: SolverProblem,
  objective: LexicographicObjective,
  columnById: ReadonlyMap<string, number>
): Float64Array {
  const costs = new Float64Array(problem.variables.length);
  for (const term of objective.terms) {
    const column = columnById.get(term.variableId);
    if (column === undefined)
      throw new Error(
        `求解目标 ${objective.id} 引用了未知变量 ${term.variableId}`
      );
    costs[column] = costs[column]! + term.coefficient;
  }
  return costs;
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
    ...locks.map(objectiveLockConstraint),
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
  const costs = objectiveCosts(problem, objective, columnById);
  return {
    numCol: problem.variables.length,
    numRow: constraints.length,
    sense: objective.direction,
    colCost: costs,
    colLower: Float64Array.from(
      problem.variables.map((variable) => variable.lowerBound ?? 0)
    ),
    colUpper: Float64Array.from(
      problem.variables.map(
        (variable) =>
          variable.upperBound ??
          (variable.type === "continuous" ? HIGHS_INF : 1)
      )
    ),
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
    integrality: Int32Array.from(
      problem.variables.map((variable) =>
        variable.type === "continuous" ? 0 : 1
      )
    ),
  };
}

function rawRows(
  constraints: readonly LinearConstraint[],
  columnById: ReadonlyMap<string, number>
): {
  lower: Float64Array;
  upper: Float64Array;
  start: Int32Array;
  index: Int32Array;
  value: Float64Array;
} {
  const starts: number[] = [];
  const indices: number[] = [];
  const coefficients: number[] = [];
  for (const constraint of constraints) {
    starts.push(indices.length);
    for (const term of constraint.terms) {
      const column = columnById.get(term.variableId);
      if (column === undefined)
        throw new Error(
          `求解约束 ${constraint.id} 引用了未知变量 ${term.variableId}`
        );
      indices.push(column);
      coefficients.push(term.coefficient);
    }
  }
  return {
    lower: Float64Array.from(
      constraints.map((constraint) => constraint.lowerBound ?? -HIGHS_INF)
    ),
    upper: Float64Array.from(
      constraints.map((constraint) => constraint.upperBound ?? HIGHS_INF)
    ),
    start: Int32Array.from(starts),
    index: Int32Array.from(indices),
    value: Float64Array.from(coefficients),
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
    if (
      variable.lowerBound !== undefined &&
      variable.upperBound !== undefined &&
      variable.lowerBound > variable.upperBound
    )
      throw new Error(`求解变量 ${variable.id} 的下限不能大于上限`);
  }
  const precedingObjectiveIds = new Set<string>();
  for (const objective of problem.objectives) {
    if (
      objective.solveOnlyWhen &&
      !precedingObjectiveIds.has(objective.solveOnlyWhen.objectiveId)
    )
      throw new Error(
        `条件目标 ${objective.id} 必须引用排在前面的目标 ${objective.solveOnlyWhen.objectiveId}`
      );
    precedingObjectiveIds.add(objective.id);
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
    if (problem.strategy === "native-lexicographic")
      return this.solveNativeLexicographic(problem);
    this.instance ??= HiGHS.create();
    const highs = await this.instance;
    const deadline = Date.now() + problem.timeoutMs;
    const locks: LockedObjective[] = [];
    const objectiveValues = new Map<string, number>();
    let finalValues: Float64Array = new Float64Array(problem.variables.length);
    const columnById = new Map(
      problem.variables.map((variable, index) => [variable.id, index])
    );
    const integralVariableIds = new Set(
      problem.variables.flatMap((variable) =>
        variable.type === "continuous" ? [] : [variable.id]
      )
    );
    for (const objective of problem.objectives) {
      if (!shouldSolveObjective(objective, objectiveValues)) continue;
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
      const value = objectiveValue(
        objective,
        finalValues,
        columnById,
        integralVariableIds
      );
      objectiveValues.set(objective.id, value);
      locks.push({ objective, value });
    }

    for (const objective of problem.objectives) {
      if (objectiveValues.has(objective.id)) continue;
      objectiveValues.set(
        objective.id,
        objectiveValue(objective, finalValues, columnById, integralVariableIds)
      );
    }

    return {
      termination: "optimal",
      selectedVariableIds: new Set(
        problem.variables.flatMap((variable, index) =>
          variable.type !== "continuous" && finalValues[index]! > 0.5
            ? [variable.id]
            : []
        )
      ),
      objectiveValues,
    };
  }

  private async solveNativeLexicographic(
    problem: SolverProblem
  ): Promise<SolverResult> {
    const deadline = Date.now() + problem.timeoutMs;
    const locks: LockedObjective[] = [];
    const objectiveValues = new Map<string, number>();
    let finalValues: Float64Array = new Float64Array(problem.variables.length);
    const columnById = new Map(
      problem.variables.map((variable, index) => [variable.id, index])
    );
    const integralVariableIds = new Set(
      problem.variables.flatMap((variable) =>
        variable.type === "continuous" ? [] : [variable.id]
      )
    );
    const emptyObjective: LexicographicObjective = {
      id: "native-lexicographic-base",
      direction: "minimize",
      terms: [],
    };

    const highs = await NativeHiGHS.create();
    let modelPassed = false;
    let loadedLockCount = 0;

    const solveBatch = async (
      objectives: readonly LexicographicObjective[]
    ): Promise<Pick<SolverResult, "termination" | "diagnostic"> | null> => {
      if (!objectives.length) return null;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0)
        return {
          termination: "timed-out",
          diagnostic: `求解目标 ${objectives[0]!.id} 前已达到时间上限`,
        };

      let passedObjectives = false;
      try {
        highs.setParam("time_limit", remainingMs / 1000);
        highs.setParam("mip_rel_gap", 0);
        highs.setParam("random_seed", 0);
        highs.setParam("output_flag", false);
        highs.setParam("blend_multi_objectives", false);
        if (!modelPassed) {
          highs.passModel(rawModel(problem, emptyObjective, []));
          modelPassed = true;
        } else {
          const pendingLocks = locks
            .slice(loadedLockCount)
            .map(objectiveLockConstraint);
          if (pendingLocks.length) {
            highs.addRows(rawRows(pendingLocks, columnById));
            loadedLockCount = locks.length;
          }
          highs.setSolutionValues(finalValues);
        }
        highs.passLinearObjectives(
          objectives.map((objective, index) => ({
            direction: objective.direction,
            coefficients: objectiveCosts(problem, objective, columnById),
            priority: objectives.length - index,
            absTolerance: 0,
            relTolerance: 0,
          }))
        );
        passedObjectives = true;
        const result = await highs.solve();
        const termination = solverTermination(result.status);
        if (termination !== "optimal")
          return {
            termination,
            diagnostic: `分层求解从目标 ${objectives[0]!.id} 开始，结束状态：${result.status}`,
          };

        finalValues = highs.getSolutionValues();
        for (const objective of objectives) {
          const value = objectiveValue(
            objective,
            finalValues,
            columnById,
            integralVariableIds
          );
          objectiveValues.set(objective.id, value);
          locks.push({ objective, value });
        }
        return null;
      } finally {
        if (passedObjectives) highs.clearLinearObjectives();
      }
    };
    try {
      let cursor = 0;
      let pending: LexicographicObjective[] = [];
      while (cursor < problem.objectives.length) {
        const objective = problem.objectives[cursor]!;
        if (!objective.solveOnlyWhen) {
          pending.push(objective);
          cursor += 1;
          continue;
        }
        if (!objectiveValues.has(objective.solveOnlyWhen.objectiveId)) {
          if (!pending.length)
            throw new Error(
              `条件目标 ${objective.id} 的前置目标尚未完成分层求解`
            );
          const failure = await solveBatch(pending);
          if (failure)
            return {
              ...failure,
              selectedVariableIds: new Set(),
              objectiveValues,
            };
          pending = [];
          continue;
        }
        if (shouldSolveObjective(objective, objectiveValues))
          pending.push(objective);
        cursor += 1;
      }

      const failure = await solveBatch(pending);
      if (failure)
        return {
          ...failure,
          selectedVariableIds: new Set(),
          objectiveValues,
        };

      for (const objective of problem.objectives) {
        if (objectiveValues.has(objective.id)) continue;
        objectiveValues.set(
          objective.id,
          objectiveValue(
            objective,
            finalValues,
            columnById,
            integralVariableIds
          )
        );
      }

      return {
        termination: "optimal",
        selectedVariableIds: new Set(
          problem.variables.flatMap((variable, index) =>
            variable.type !== "continuous" && finalValues[index]! > 0.5
              ? [variable.id]
              : []
          )
        ),
        objectiveValues,
      };
    } finally {
      highs.free();
    }
  }
}

export const defaultHighsSolver: SolverPort = new HighsSolver();
