import type { AppState, ScheduleResult } from "../../model";
import { assertScheduleSafetyCredential } from "./schedule-safety-credential";
import { scheduleRuleFingerprint } from "../rules/schedule-rule-fingerprint";

export function clearActiveSchedule(state: AppState): void {
  state.assignments = [];
  state.activeScheduleDate = null;
  state.schedulePolicyStale = false;
  delete state.scheduleRuleFingerprint;
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
  state.scheduleRuleFingerprint = scheduleRuleFingerprint(state);
}
