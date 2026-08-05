import type {
  AppState,
  Assignment,
  HistoryRecord,
  PositionRule,
  Staff,
} from "../../model";
import { assignmentRule } from "../flights/schedule-position-rules";
import { endsAfterLateShiftThreshold } from "../reviews/late-priority-policy";
import { isSupervisorPosition } from "../reviews/late-priority-policy";

export const LATE_PRIORITY_STATISTICS_CATEGORIES = [
  "督导",
  "一号",
  "申报",
  "送资料",
] as const;

export type LatePriorityStatisticsCategory =
  (typeof LATE_PRIORITY_STATISTICS_CATEGORIES)[number];

export interface MonthlyLatePriorityStatisticsRow {
  staff: Staff;
  dates: string[];
  supervisorQualified: boolean;
}

export interface MonthlyLatePriorityStatistics {
  month: string;
  flightNo: string;
  category: LatePriorityStatisticsCategory;
  configured: boolean;
  rows: MonthlyLatePriorityStatisticsRow[];
  range: { min: number; max: number; difference: number };
}

function normalized(value: string): string {
  return value.trim().toUpperCase().replaceAll(/\s+/g, "");
}

function searchablePosition(
  rule: Pick<PositionRule, "name" | "remark">
): string {
  return `${rule.name} ${rule.remark}`.trim().toUpperCase();
}

function matchesCategory(
  rule: PositionRule,
  category: LatePriorityStatisticsCategory
): boolean {
  return (
    rule.category === "常规" && searchablePosition(rule).includes(category)
  );
}

function lateFlightExists(state: AppState, flightNo: string): boolean {
  return state.flights.some(
    (flight) =>
      normalized(flight.flightNo) === normalized(flightNo) &&
      endsAfterLateShiftThreshold(flight, state.settings.lateShiftEndTime)
  );
}

function targetRules(
  state: AppState,
  flightNo: string,
  category: LatePriorityStatisticsCategory
): PositionRule[] {
  if (!lateFlightExists(state, flightNo)) return [];
  const normalizedFlightNo = normalized(flightNo);
  return state.positionRules.filter(
    (rule) =>
      normalized(rule.flightNo) === normalizedFlightNo &&
      matchesCategory(rule, category)
  );
}

function recordMatchesRule(record: HistoryRecord, rule: PositionRule): boolean {
  return (
    normalized(record.flightNo) === normalized(rule.flightNo) &&
    normalized(record.position) === normalized(rule.name)
  );
}

function assignmentMatchesRule(
  state: AppState,
  assignment: Assignment,
  rulesById: Set<string>
): boolean {
  const rule = assignmentRule(state, assignment);
  return Boolean(rule && rulesById.has(rule.id));
}

function emptyRange(): MonthlyLatePriorityStatistics["range"] {
  return { min: 0, max: 0, difference: 0 };
}

export function latePriorityStatisticsFlightNumbers(state: AppState): string[] {
  const seen = new Set<string>();
  return state.flights
    .filter((flight) =>
      endsAfterLateShiftThreshold(flight, state.settings.lateShiftEndTime)
    )
    .filter((flight) =>
      state.positionRules.some(
        (rule) =>
          normalized(rule.flightNo) === normalized(flight.flightNo) &&
          LATE_PRIORITY_STATISTICS_CATEGORIES.some((category) =>
            matchesCategory(rule, category)
          )
      )
    )
    .filter((flight) => {
      const key = normalized(flight.flightNo);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((flight) => flight.flightNo);
}

export function buildMonthlyLatePriorityStatistics(
  state: AppState,
  date: string,
  flightNo: string,
  category: LatePriorityStatisticsCategory
): MonthlyLatePriorityStatistics {
  const month = date.slice(0, 7);
  const rules = targetRules(state, flightNo, category);
  const qualifiedIds = new Set(rules.flatMap((rule) => rule.qualifiedStaffIds));
  const eligibleStaff = state.staff.filter(
    (person) =>
      qualifiedIds.has(person.id) &&
      person.staffType === "常规" &&
      person.status === "正常"
  );
  const eligibleIds = new Set(eligibleStaff.map((person) => person.id));
  const supervisorQualifiedIds = new Set(
    state.positionRules
      .filter(
        (rule) =>
          rule.category === "常规" &&
          normalized(rule.flightNo) === normalized(flightNo) &&
          isSupervisorPosition(rule)
      )
      .flatMap((rule) => rule.qualifiedStaffIds)
  );
  const staffOrder = new Map(
    state.staff.map((person, index) => [person.id, index])
  );
  const datesByStaff = new Map<string, Set<string>>(
    eligibleStaff.map((person) => [person.id, new Set<string>()])
  );
  const activeDate =
    state.activeScheduleDate === date && state.assignments.length ? date : null;

  state.history
    .filter(
      (record) => record.date.startsWith(month) && record.date !== activeDate
    )
    .filter(
      (record) =>
        eligibleIds.has(record.staffId) &&
        endsAfterLateShiftThreshold(record, state.settings.lateShiftEndTime)
    )
    .forEach((record) => {
      if (
        rules.some(
          (rule) =>
            rule.qualifiedStaffIds.includes(record.staffId) &&
            recordMatchesRule(record, rule)
        )
      ) {
        datesByStaff.get(record.staffId)?.add(record.date);
      }
    });

  if (activeDate) {
    const ruleIds = new Set(rules.map((rule) => rule.id));
    state.assignments
      .filter(
        (assignment) =>
          assignment.status === "assigned" &&
          Boolean(assignment.staffId) &&
          eligibleIds.has(assignment.staffId!) &&
          endsAfterLateShiftThreshold(
            assignment,
            state.settings.lateShiftEndTime
          ) &&
          assignmentMatchesRule(state, assignment, ruleIds)
      )
      .forEach((assignment) =>
        datesByStaff.get(assignment.staffId!)?.add(activeDate)
      );
  }

  const rows = eligibleStaff
    .map((staff) => ({
      staff,
      dates: [...(datesByStaff.get(staff.id) ?? [])].sort(),
      supervisorQualified: supervisorQualifiedIds.has(staff.id),
    }))
    .sort(
      (left, right) =>
        left.dates.length - right.dates.length ||
        (staffOrder.get(left.staff.id) ?? Number.MAX_SAFE_INTEGER) -
          (staffOrder.get(right.staff.id) ?? Number.MAX_SAFE_INTEGER)
    );
  const fairnessRows =
    category === "申报" || category === "送资料"
      ? rows.filter((row) => !row.supervisorQualified)
      : rows;
  const rangeRows = fairnessRows.length ? fairnessRows : rows;
  const counts = rangeRows.map((row) => row.dates.length);
  const range = counts.length
    ? {
        min: Math.min(...counts),
        max: Math.max(...counts),
        difference: Math.max(...counts) - Math.min(...counts),
      }
    : emptyRange();

  return {
    month,
    flightNo,
    category,
    configured: rules.length > 0,
    rows,
    range,
  };
}
