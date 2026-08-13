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

function objectiveVariableBound(
  problem: SolverProblem,
  objective: LexicographicObjective,
  columnById: ReadonlyMap<string, number>
): number | undefined {
  const costs = objectiveCosts(problem, objective, columnById);
  let bound = 0;
  for (const [index, coefficient] of costs.entries()) {
    if (coefficient === 0) continue;
    const variable = problem.variables[index]!;
    const lowerBound = variable.lowerBound ?? 0;
    const upperBound =
      variable.upperBound ?? (variable.type === "continuous" ? undefined : 1);
    const endpoint =
      objective.direction === "minimize"
        ? coefficient > 0
          ? lowerBound
          : upperBound
        : coefficient > 0
          ? upperBound
          : lowerBound;
    if (endpoint === undefined || !Number.isFinite(endpoint)) return undefined;
    bound += coefficient * endpoint;
  }
  return Math.abs(bound) < 1e-9 ? 0 : Number(bound.toPrecision(12));
}

function reachesVariableBound(value: number, bound: number): boolean {
  const tolerance =
    OBJECTIVE_LOCK_TOLERANCE * Math.max(1, Math.abs(value), Math.abs(bound));
  return Math.abs(value - bound) <= tolerance;
}

function objectiveAbsoluteGap(objective: LexicographicObjective): number {
  if (objective.optimality !== "best-effort") return 0;
  return objective.acceptedGap?.absolute ?? 0;
}

function objectiveRelativeGap(objective: LexicographicObjective): number {
  return objective.optimality === "best-effort"
    ? (objective.acceptedGap?.relative ?? 0)
    : 0;
}

function resultGapKind(
  objective: LexicographicObjective,
  result: {
    mipGap?: number;
    mipDualBound?: number;
    objective?: number;
  }
): "exact" | "accepted" | "rejected" {
  const relativeGap = result.mipGap;
  if (relativeGap === undefined) return "exact";
  if (!Number.isFinite(relativeGap) || relativeGap < 0) return "rejected";
  if (relativeGap <= OBJECTIVE_LOCK_TOLERANCE) return "exact";
  if (objective.optimality !== "best-effort") return "rejected";
  if (
    relativeGap <=
    (objective.acceptedGap?.relative ?? 0) + OBJECTIVE_LOCK_TOLERANCE
  )
    return "accepted";
  const absoluteGap =
    result.objective !== undefined && result.mipDualBound !== undefined
      ? Math.abs(result.objective - result.mipDualBound)
      : Number.POSITIVE_INFINITY;
  return absoluteGap <=
    (objective.acceptedGap?.absolute ?? 0) + OBJECTIVE_LOCK_TOLERANCE
    ? "accepted"
    : "rejected";
}

function normalizeLowerEnvelopeValues(
  problem: SolverProblem,
  objective: LexicographicObjective,
  values: Float64Array,
  columnById: ReadonlyMap<string, number>,
  lockedVariableIds: ReadonlySet<string>
): Float64Array {
  if (objective.direction !== "minimize") return values;
  const costs = objectiveCosts(problem, objective, columnById);
  let normalized: Float64Array | undefined;
  for (const [index, coefficient] of costs.entries()) {
    const variable = problem.variables[index]!;
    if (
      coefficient <= 0 ||
      !variable.lowerEnvelope ||
      lockedVariableIds.has(variable.id)
    )
      continue;
    let lowerBound = variable.lowerBound ?? 0;
    for (const constraint of problem.constraints) {
      if (constraint.lowerBound === undefined) continue;
      const ownTerm = constraint.terms.find(
        (term) => term.variableId === variable.id
      );
      if (!ownTerm || ownTerm.coefficient <= 0) continue;
      const otherValue = constraint.terms.reduce((total, term) => {
        if (term.variableId === variable.id) return total;
        return (
          total + term.coefficient * values[columnById.get(term.variableId)!]!
        );
      }, 0);
      lowerBound = Math.max(
        lowerBound,
        (constraint.lowerBound - otherValue) / ownTerm.coefficient
      );
    }
    const upperBound = variable.upperBound ?? HIGHS_INF;
    const tightened = Math.min(upperBound, lowerBound);
    if (Math.abs(tightened - values[index]!) <= 1e-9) continue;
    normalized ??= Float64Array.from(values);
    normalized[index] = tightened;
  }
  return normalized ?? values;
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
  let reachedBestEffort = false;
  for (const objective of problem.objectives) {
    if (
      objective.objectiveValueStep !== undefined &&
      (!Number.isFinite(objective.objectiveValueStep) ||
        objective.objectiveValueStep <= 0)
    )
      throw new Error(`求解目标 ${objective.id} 的离散步长必须大于 0`);
    if (objective.optimality === "best-effort") reachedBestEffort = true;
    else if (reachedBestEffort)
      throw new Error(
        `必须最优的目标 ${objective.id} 不能排在限时优化目标之后`
      );
    const relativeGap = objective.acceptedGap?.relative ?? 0;
    const absoluteGap = objective.acceptedGap?.absolute ?? 0;
    if (
      !Number.isFinite(relativeGap) ||
      !Number.isFinite(absoluteGap) ||
      relativeGap < 0 ||
      absoluteGap < 0
    )
      throw new Error(`求解目标 ${objective.id} 的允许差距必须是非负有限数`);
    if (
      objective.optimality !== "best-effort" &&
      (relativeGap !== 0 || absoluteGap !== 0)
    )
      throw new Error(`required 目标 ${objective.id} 不能声明非零允许差距`);
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

  solve(
    problem: SolverProblem,
    options?: Parameters<SolverPort["solve"]>[1]
  ): Promise<SolverResult> {
    const pending = this.queue.then(
      () => this.solveExclusive(problem, options),
      () => this.solveExclusive(problem, options)
    );
    this.queue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private async solveExclusive(
    problem: SolverProblem,
    options?: Parameters<SolverPort["solve"]>[1]
  ): Promise<SolverResult> {
    validateProblem(problem);
    if (problem.strategy === "native-lexicographic")
      return this.solveNativeLexicographic(problem, options);
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
      highs.setParam("mip_rel_gap", objectiveRelativeGap(objective));
      highs.setParam("mip_abs_gap", objectiveAbsoluteGap(objective));
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
    problem: SolverProblem,
    options?: Parameters<SolverPort["solve"]>[1]
  ): Promise<SolverResult> {
    const deadline = Date.now() + problem.timeoutMs;
    const locks: LockedObjective[] = [];
    const objectiveValues = new Map<string, number>();
    const completedObjectiveIds: string[] = [];
    const approximatedObjectiveIds: string[] = [];
    let finalValues: Float64Array | undefined;
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
    let requiredSolutionReported = false;

    const selectedVariableIds = (values: Float64Array): Set<string> =>
      new Set(
        problem.variables.flatMap((variable, index) =>
          variable.type !== "continuous" && values[index]! > 0.5
            ? [variable.id]
            : []
        )
      );

    const completeObjectiveValues = (values: Float64Array): void => {
      for (const objective of problem.objectives) {
        if (objectiveValues.has(objective.id)) continue;
        objectiveValues.set(
          objective.id,
          objectiveValue(objective, values, columnById, integralVariableIds)
        );
      }
    };

    const timeLimitedResult = (
      objective: LexicographicObjective,
      solutionSource: "current-incumbent" | "previous-optimal"
    ): SolverResult => {
      if (!finalValues)
        return {
          termination: "timed-out",
          selectedVariableIds: new Set(),
          objectiveValues,
          diagnostic: `求解目标 ${objective.id} 前已达到时间上限`,
        };
      completeObjectiveValues(finalValues);
      return {
        termination: "time-limited-feasible",
        selectedVariableIds: selectedVariableIds(finalValues),
        objectiveValues,
        bestEffort: {
          stoppedAtObjectiveId: objective.id,
          completedObjectiveIds: [...completedObjectiveIds],
          solutionSource,
        },
      };
    };
    try {
      for (const objective of problem.objectives) {
        if (
          !requiredSolutionReported &&
          objective.optimality === "best-effort" &&
          finalValues
        ) {
          requiredSolutionReported = true;
          options?.onRequiredSolution?.({
            termination: "optimal",
            selectedVariableIds: selectedVariableIds(finalValues),
            objectiveValues: new Map(objectiveValues),
          });
        }
        if (!shouldSolveObjective(objective, objectiveValues)) continue;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          if (objective.optimality === "best-effort")
            return timeLimitedResult(objective, "previous-optimal");
          return {
            termination: "timed-out",
            selectedVariableIds: new Set(),
            objectiveValues,
            diagnostic: `求解目标 ${objective.id} 前已达到时间上限`,
          };
        }

        if (finalValues) {
          const lockedVariableIds = new Set(
            locks.flatMap((lock) =>
              lock.objective.terms.map((term) => term.variableId)
            )
          );
          finalValues = normalizeLowerEnvelopeValues(
            problem,
            objective,
            finalValues,
            columnById,
            lockedVariableIds
          );
          const currentValue = objectiveValue(
            objective,
            finalValues,
            columnById,
            integralVariableIds
          );
          const variableBound = objectiveVariableBound(
            problem,
            objective,
            columnById
          );
          if (
            variableBound !== undefined &&
            !objective.acceptedGap &&
            reachesVariableBound(currentValue, variableBound)
          ) {
            objectiveValues.set(objective.id, currentValue);
            locks.push({ objective, value: currentValue });
            completedObjectiveIds.push(objective.id);
            continue;
          }
        }

        if (!modelPassed) {
          highs.passModel(rawModel(problem, emptyObjective, []));
          modelPassed = true;
        } else {
          const pendingRows: LinearConstraint[] = locks
            .slice(loadedLockCount)
            .map(objectiveLockConstraint);
          if (pendingRows.length) {
            highs.addRows(rawRows(pendingRows, columnById));
            loadedLockCount = locks.length;
          }
          if (finalValues) highs.setSolutionValues(finalValues);
        }

        highs.zeroAllClocks();
        highs.setParam("time_limit", remainingMs / 1000);
        highs.setParam("mip_rel_gap", objectiveRelativeGap(objective));
        highs.setParam("mip_abs_gap", objectiveAbsoluteGap(objective));
        highs.setParam("random_seed", 0);
        highs.setParam("output_flag", false);
        highs.setParam("blend_multi_objectives", false);
        highs.passLinearObjectives([
          {
            direction: objective.direction,
            coefficients: objectiveCosts(problem, objective, columnById),
            priority: 1,
            absTolerance: 0,
            relTolerance: 0,
          },
        ]);

        let result: Awaited<ReturnType<typeof highs.solve>>;
        try {
          result = await highs.solve();
        } finally {
          highs.clearLinearObjectives();
        }
        const termination = solverTermination(result.status);
        if (termination === "optimal") {
          if (result.solutionStatus !== "feasible")
            return {
              termination: "failed",
              selectedVariableIds: new Set(),
              objectiveValues,
              diagnostic: `求解目标 ${objective.id} 已完成但没有有效完整解`,
            };
          const gapKind = resultGapKind(objective, result);
          if (gapKind === "rejected")
            return {
              termination: "failed",
              selectedVariableIds: new Set(),
              objectiveValues,
              diagnostic: `求解目标 ${objective.id} 未达到允许的完成范围`,
            };
          finalValues = highs.getSolutionValues();
          const value = objectiveValue(
            objective,
            finalValues,
            columnById,
            integralVariableIds
          );
          objectiveValues.set(objective.id, value);
          locks.push({ objective, value });
          completedObjectiveIds.push(objective.id);
          if (gapKind === "accepted")
            approximatedObjectiveIds.push(objective.id);
          if (objective.optimality === "best-effort") {
            options?.onBestEffortSolution?.({
              termination:
                gapKind === "accepted" ? "gap-limited-feasible" : "optimal",
              selectedVariableIds: selectedVariableIds(finalValues),
              objectiveValues: new Map(objectiveValues),
              ...(gapKind === "accepted"
                ? { approximatedObjectiveIds: [...approximatedObjectiveIds] }
                : {}),
            });
          }
          continue;
        }

        if (
          result.status === "timelimit" &&
          objective.optimality === "best-effort" &&
          finalValues
        ) {
          let solutionSource: "current-incumbent" | "previous-optimal" =
            "previous-optimal";
          if (result.solutionStatus === "feasible") {
            finalValues = highs.getSolutionValues();
            solutionSource = "current-incumbent";
          }
          return timeLimitedResult(objective, solutionSource);
        }

        return {
          termination,
          selectedVariableIds: new Set(),
          objectiveValues,
          diagnostic: `求解目标 ${objective.id} 结束状态：${result.status}`,
        };
      }

      if (!finalValues)
        return {
          termination: "failed",
          selectedVariableIds: new Set(),
          objectiveValues,
          diagnostic: "分层求解没有生成完整解",
        };
      completeObjectiveValues(finalValues);

      return {
        termination: approximatedObjectiveIds.length
          ? "gap-limited-feasible"
          : "optimal",
        selectedVariableIds: selectedVariableIds(finalValues),
        objectiveValues,
        ...(approximatedObjectiveIds.length
          ? {
              approximatedObjectiveIds,
              bestEffort: {
                stoppedAtObjectiveId:
                  approximatedObjectiveIds[
                    approximatedObjectiveIds.length - 1
                  ]!,
                completedObjectiveIds: [...completedObjectiveIds],
                solutionSource: "current-incumbent" as const,
              },
            }
          : {}),
      };
    } finally {
      highs.free();
    }
  }
}

export const defaultHighsSolver: SolverPort = new HighsSolver();
