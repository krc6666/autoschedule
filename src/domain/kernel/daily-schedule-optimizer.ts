import type { AppState } from "../../model";
import type { SolverPort } from "../solver/solver-port";
import { dailyScheduleFailureMessage } from "../solver/solver-user-message";
import { buildDailyScheduleModel } from "./daily-schedule-model";
import {
  materializeValidatedDailySchedulePlan,
  validatedPlanCallback,
  type DailySchedulePlan,
} from "./daily-schedule-result";
import { assertTimeLimitedResultIsEligible } from "./daily-schedule-safety";
import type { SchedulePreparation } from "./schedule-preparation";

const DAILY_SCHEDULE_TIMEOUT_MS = 150_000;
export interface OptimizeDailyScheduleOptions {
  solver: SolverPort;
  state: AppState;
  date: string;
  preparation: SchedulePreparation;
  onRequiredPlan?: (plan: DailySchedulePlan) => void;
  onImprovedPlan?: (plan: DailySchedulePlan) => void;
}

export async function optimizeDailySchedule({
  solver,
  state,
  date,
  preparation,
  onRequiredPlan,
  onImprovedPlan,
}: OptimizeDailyScheduleOptions): Promise<DailySchedulePlan> {
  const deadline = Date.now() + DAILY_SCHEDULE_TIMEOUT_MS;
  const model = buildDailyScheduleModel({
    state,
    date,
    preparation,
    timeoutMs: DAILY_SCHEDULE_TIMEOUT_MS,
  });
  if (!model)
    return {
      assignments: [],
      lockedAssignmentIds: new Set(),
      warnings: [],
      optimizationQuality: "all-objectives-optimal",
    };

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("当天整体排班计算超过150秒，请重试");
  const materializePlan = (
    selectedVariableIds: ReadonlySet<string>,
    optimizationQuality: DailySchedulePlan["optimizationQuality"]
  ) =>
    materializeValidatedDailySchedulePlan({
      state,
      date,
      preparation,
      model,
      selectedVariableIds,
      optimizationQuality,
    });
  const result = await solver.solve(
    {
      ...model.problem,
      timeoutMs: remainingMs,
    },
    onRequiredPlan || onImprovedPlan
      ? {
          onRequiredSolution: validatedPlanCallback(
            { state, date, preparation, model },
            onRequiredPlan,
            () => "fairness-user-stopped"
          ),
          onBestEffortSolution: validatedPlanCallback(
            { state, date, preparation, model },
            onImprovedPlan,
            () => "fairness-user-stopped"
          ),
        }
      : undefined
  );
  if (
    result.termination !== "optimal" &&
    result.termination !== "gap-limited-feasible" &&
    result.termination !== "time-limited-feasible"
  )
    throw new Error(dailyScheduleFailureMessage(result.termination));
  assertTimeLimitedResultIsEligible(model.problem, result);

  return materializePlan(
    result.selectedVariableIds,
    result.termination === "gap-limited-feasible"
      ? "fairness-gap-limited"
      : result.termination === "time-limited-feasible"
        ? "fairness-time-limited"
        : "all-objectives-optimal"
  );
}
