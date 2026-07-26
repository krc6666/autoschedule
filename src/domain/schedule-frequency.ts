import type { AppState, Assignment, PositionRule } from "../model";
import { recentArchivedWorkdays } from "./fatigue";
import { assignmentRule } from "./schedule-position-rules";
import { normalizedPolicyValue } from "./schedule-protection";
import { isPriorityRotationPosition } from "./scheduling-policy";

export function consecutivePositionAssignments(
  state: AppState,
  staffId: string,
  flightNo: string,
  position: string,
  date: string
): number {
  if (!state.settings.positionRotationEnabled) return 0;
  const normalizedFlight = normalizedPolicyValue(flightNo);
  const normalizedPosition = normalizedPolicyValue(position);
  const workdays = [...new Set(recentArchivedWorkdays(state.history, date, 2)
    .map((record) => record.date))]
    .sort((left, right) => right.localeCompare(left));
  let count = 0;
  for (const workday of workdays) {
    const repeated = state.history.some((record) => record.date === workday
      && record.staffId === staffId
      && normalizedPolicyValue(record.flightNo) === normalizedFlight
      && normalizedPolicyValue(record.position) === normalizedPosition);
    if (!repeated) break;
    count += 1;
  }
  return count;
}

export const POSITION_FREQUENCY_WORKDAY_COUNT = 6;

export interface PositionFrequencyProfile {
  currentMonthCount: number;
  recentWorkdayCount: number;
}

function matchingPositionHistory(
  state: AppState,
  staffId: string,
  flightNo: string,
  position: string
): AppState["history"] {
  const normalizedFlight = normalizedPolicyValue(flightNo);
  const normalizedPosition = normalizedPolicyValue(position);
  return state.history.filter((record) => record.staffId === staffId
    && normalizedPolicyValue(record.flightNo) === normalizedFlight
    && normalizedPolicyValue(record.position) === normalizedPosition);
}

export function samePositionFrequencyProfile(
  state: AppState,
  staffId: string,
  flightNo: string,
  position: string,
  date: string
): PositionFrequencyProfile {
  if (!state.settings.positionRotationEnabled) return { currentMonthCount: 0, recentWorkdayCount: 0 };
  const matching = matchingPositionHistory(state, staffId, flightNo, position);
  const currentMonth = /^\d{4}-\d{2}/.exec(date)?.[0] ?? "";
  const recentIds = new Set(recentArchivedWorkdays(state.history, date, POSITION_FREQUENCY_WORKDAY_COUNT)
    .map((record) => record.id));
  return {
    currentMonthCount: matching.filter((record) => record.date < date && record.date.startsWith(currentMonth)).length,
    recentWorkdayCount: matching.filter((record) => recentIds.has(record.id)).length
  };
}

export function positionFrequencyProfileForRule(
  state: AppState,
  staffId: string,
  flightNo: string,
  rule: Pick<PositionRule, "category" | "name" | "remark">,
  date: string
): PositionFrequencyProfile {
  return isPriorityRotationPosition(rule)
    ? samePositionFrequencyProfile(state, staffId, flightNo, rule.name, date)
    : { currentMonthCount: 0, recentWorkdayCount: 0 };
}

export function positionFrequencyProfileForAssignment(
  state: AppState,
  assignment: Assignment,
  staffId: string,
  date: string
): PositionFrequencyProfile {
  const rule = assignmentRule(state, assignment);
  return rule
    ? positionFrequencyProfileForRule(state, staffId, assignment.flightNo, rule, date)
    : { currentMonthCount: 0, recentWorkdayCount: 0 };
}

export function comparePositionFrequency(left: PositionFrequencyProfile, right: PositionFrequencyProfile): number {
  return left.currentMonthCount - right.currentMonthCount
    || left.recentWorkdayCount - right.recentWorkdayCount;
}
