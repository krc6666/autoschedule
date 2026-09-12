import type { AppState, ScheduleResult } from "../../model";
import { assertScheduleSafetyCredential } from "./schedule-safety-credential";

export function clearActiveSchedule(state: AppState): void {
  state.assignments = [];
  state.activeScheduleDate = null;
  state.schedulePolicyStale = false;
}

export function markActiveScheduleStale(state: AppState): boolean {
  state.schedulePolicyStale = state.assignments.length > 0;
  return state.schedulePolicyStale;
}

export function installGeneratedSchedule(
  state: AppState,
  date: string,
  result: ScheduleResult
): void {
  assertScheduleSafetyCredential({ date, result });
  state.assignments = result.assignments;
  state.activeScheduleDate = date;
  state.schedulePolicyStale = false;
}
