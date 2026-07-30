import type { AppState, ScheduleResult } from "../model";

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
  state.assignments = result.assignments;
  state.activeScheduleDate = date;
  state.schedulePolicyStale = false;
}
