import type { AppState, Staff } from "../../model";

export interface PositionStatisticsTarget {
  flightNo: string;
  position: string;
}

export interface MonthlyPositionStatisticsRow {
  staff: Staff;
  dates: string[];
}

export interface MonthlyPositionStatistics {
  month: string;
  target: PositionStatisticsTarget;
  configured: boolean;
  rows: MonthlyPositionStatisticsRow[];
  range: { min: number; max: number; difference: number };
}

function normalized(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/g, "");
}

function emptyRange(): MonthlyPositionStatistics["range"] {
  return { min: 0, max: 0, difference: 0 };
}

export function buildMonthlyPositionStatistics(
  state: AppState,
  date: string,
  target: PositionStatisticsTarget
): MonthlyPositionStatistics {
  const month = date.slice(0, 7);
  const targetFlightNo = normalized(target.flightNo);
  const targetPosition = normalized(target.position);
  const targetRules = state.positionRules.filter(
    (rule) =>
      rule.category === "常规" &&
      normalized(rule.flightNo) === targetFlightNo &&
      normalized(rule.name) === targetPosition
  );
  const configured = targetRules.length > 0;
  const qualifiedIds = new Set(
    targetRules.flatMap((rule) => rule.qualifiedStaffIds)
  );
  const staffOrder = new Map(
    state.staff.map((person, index) => [person.id, index])
  );
  const eligibleStaff = state.staff.filter(
    (person) =>
      qualifiedIds.has(person.id) &&
      person.staffType === "常规" &&
      person.status === "正常"
  );
  const eligibleIds = new Set(eligibleStaff.map((person) => person.id));
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
        normalized(record.flightNo) === targetFlightNo &&
        normalized(record.position) === targetPosition
    )
    .filter((record) => eligibleIds.has(record.staffId))
    .forEach((record) => datesByStaff.get(record.staffId)?.add(record.date));

  if (activeDate) {
    const targetRuleIds = new Set(targetRules.map((rule) => rule.id));
    state.assignments
      .filter(
        (assignment) =>
          assignment.status === "assigned" && Boolean(assignment.staffId)
      )
      .filter(
        (assignment) =>
          normalized(assignment.flightNo) === targetFlightNo &&
          normalized(assignment.position) === targetPosition
      )
      .filter((assignment) =>
        Boolean(
          assignment.positionRuleId &&
          targetRuleIds.has(assignment.positionRuleId)
        )
      )
      .filter((assignment) => eligibleIds.has(assignment.staffId!))
      .forEach((assignment) =>
        datesByStaff.get(assignment.staffId!)?.add(activeDate)
      );
  }

  const rows = eligibleStaff
    .map((staff) => ({
      staff,
      dates: [...(datesByStaff.get(staff.id) ?? [])].sort(),
    }))
    .sort(
      (left, right) =>
        left.dates.length - right.dates.length ||
        (staffOrder.get(left.staff.id) ?? Number.MAX_SAFE_INTEGER) -
          (staffOrder.get(right.staff.id) ?? Number.MAX_SAFE_INTEGER)
    );
  const counts = rows.map((row) => row.dates.length);
  const range = counts.length
    ? {
        min: Math.min(...counts),
        max: Math.max(...counts),
        difference: Math.max(...counts) - Math.min(...counts),
      }
    : emptyRange();

  return { month, target, configured, rows, range };
}
