import type { AppState } from "../../model";
import type { SolverPort } from "../solver/solver-port";
import { dailyScheduleFailureMessage } from "../solver/solver-user-message";
import { buildDailyScheduleModel } from "./daily-schedule-model";
import {
  materializeDailySchedulePlan,
  type DailySchedulePlan,
} from "./daily-schedule-result";
import type { SchedulePreparation } from "./schedule-preparation";

const DAILY_SCHEDULE_TIMEOUT_MS = 30_000;

export interface OptimizeDailyScheduleOptions {
  solver: SolverPort;
  state: AppState;
  date: string;
  preparation: SchedulePreparation;
}

export async function optimizeDailySchedule({
  solver,
  state,
  date,
  preparation,
}: OptimizeDailyScheduleOptions): Promise<DailySchedulePlan> {
  const deadline = Date.now() + DAILY_SCHEDULE_TIMEOUT_MS;
  const model = buildDailyScheduleModel({
    state,
    date,
    preparation,
    timeoutMs: DAILY_SCHEDULE_TIMEOUT_MS,
  });
  if (!model)
    return { assignments: [], lockedAssignmentIds: new Set(), warnings: [] };

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("当天整体排班计算超过30秒，请重试");
  const result = await solver.solve({
    ...model.problem,
    timeoutMs: remainingMs,
  });
  if (result.termination !== "optimal")
    throw new Error(dailyScheduleFailureMessage(result.termination));

  return materializeDailySchedulePlan({
    state,
    date,
    preparation,
    model,
    selectedVariableIds: result.selectedVariableIds,
  });
}
