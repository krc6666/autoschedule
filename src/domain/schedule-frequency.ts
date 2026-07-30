import type {
  AppState,
  Assignment,
  HistoryRecord,
  PositionRule,
} from "../model";
import { recentArchivedWorkdays } from "./fatigue";
import { assignmentRule } from "./schedule-position-rules";
import { normalizedPolicyValue } from "./schedule-protection";
import { isPriorityRotationPosition } from "./position-rotation-policy";

export interface ScheduleFrequencyFacts {
  date: string;
  recentConsecutiveWorkdays: readonly string[];
  recentFrequencyRecordIds: ReadonlySet<string>;
  recordsByPosition: ReadonlyMap<string, readonly HistoryRecord[]>;
}

function positionHistoryKey(
  staffId: string,
  flightNo: string,
  position: string
): string {
  return [
    staffId,
    normalizedPolicyValue(flightNo),
    normalizedPolicyValue(position),
  ].join("\u0000");
}

export function createScheduleFrequencyFacts(
  state: AppState,
  date: string
): ScheduleFrequencyFacts {
  const recordsByPosition = new Map<string, HistoryRecord[]>();
  for (const record of state.history) {
    const key = positionHistoryKey(
      record.staffId,
      record.flightNo,
      record.position
    );
    const records = recordsByPosition.get(key) ?? [];
    records.push(record);
    recordsByPosition.set(key, records);
  }
  return {
    date,
    recentConsecutiveWorkdays: [
      ...new Set(
        recentArchivedWorkdays(state.history, date, 2).map(
          (record) => record.date
        )
      ),
    ].sort((left, right) => right.localeCompare(left)),
    recentFrequencyRecordIds: new Set(
      recentArchivedWorkdays(
        state.history,
        date,
        POSITION_FREQUENCY_WORKDAY_COUNT
      ).map((record) => record.id)
    ),
    recordsByPosition,
  };
}

function frequencyFactsFor(
  state: AppState,
  date: string,
  facts?: ScheduleFrequencyFacts
): ScheduleFrequencyFacts {
  return facts?.date === date
    ? facts
    : createScheduleFrequencyFacts(state, date);
}

export function consecutivePositionAssignments(
  state: AppState,
  staffId: string,
  flightNo: string,
  position: string,
  date: string,
  facts?: ScheduleFrequencyFacts
): number {
  if (!state.settings.positionRotationEnabled) return 0;
  const scheduleFacts = frequencyFactsFor(state, date, facts);
  const records =
    scheduleFacts.recordsByPosition.get(
      positionHistoryKey(staffId, flightNo, position)
    ) ?? [];
  const recordedDates = new Set(records.map((record) => record.date));
  let count = 0;
  for (const workday of scheduleFacts.recentConsecutiveWorkdays) {
    if (!recordedDates.has(workday)) break;
    count += 1;
  }
  return count;
}

export const POSITION_FREQUENCY_WORKDAY_COUNT = 6;

export interface PositionFrequencyProfile {
  currentMonthCount: number;
  recentWorkdayCount: number;
}

export function samePositionFrequencyProfile(
  state: AppState,
  staffId: string,
  flightNo: string,
  position: string,
  date: string,
  facts?: ScheduleFrequencyFacts
): PositionFrequencyProfile {
  if (!state.settings.positionRotationEnabled)
    return { currentMonthCount: 0, recentWorkdayCount: 0 };
  const scheduleFacts = frequencyFactsFor(state, date, facts);
  const matching =
    scheduleFacts.recordsByPosition.get(
      positionHistoryKey(staffId, flightNo, position)
    ) ?? [];
  const currentMonth = /^\d{4}-\d{2}/.exec(date)?.[0] ?? "";
  return {
    currentMonthCount: matching.filter(
      (record) => record.date < date && record.date.startsWith(currentMonth)
    ).length,
    recentWorkdayCount: matching.filter((record) =>
      scheduleFacts.recentFrequencyRecordIds.has(record.id)
    ).length,
  };
}

export function positionFrequencyProfileForRule(
  state: AppState,
  staffId: string,
  flightNo: string,
  rule: Pick<PositionRule, "category" | "name" | "remark">,
  date: string,
  facts?: ScheduleFrequencyFacts
): PositionFrequencyProfile {
  return isPriorityRotationPosition(rule)
    ? samePositionFrequencyProfile(
        state,
        staffId,
        flightNo,
        rule.name,
        date,
        facts
      )
    : { currentMonthCount: 0, recentWorkdayCount: 0 };
}

export function positionFrequencyProfileForAssignment(
  state: AppState,
  assignment: Assignment,
  staffId: string,
  date: string,
  facts?: ScheduleFrequencyFacts
): PositionFrequencyProfile {
  const rule = assignmentRule(state, assignment);
  return rule
    ? positionFrequencyProfileForRule(
        state,
        staffId,
        assignment.flightNo,
        rule,
        date,
        facts
      )
    : { currentMonthCount: 0, recentWorkdayCount: 0 };
}

export function comparePositionFrequency(
  left: PositionFrequencyProfile,
  right: PositionFrequencyProfile
): number {
  return (
    left.currentMonthCount - right.currentMonthCount ||
    left.recentWorkdayCount - right.recentWorkdayCount
  );
}
