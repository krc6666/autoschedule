import type {
  AppState,
  Assignment,
  Flight,
  HistoryRecord,
  PositionRule,
} from "../../model";
import {
  createScheduleFrequencyFacts,
  type ScheduleFrequencyFacts,
} from "./schedule-frequency";
import {
  isLatePriorityPosition,
  isSupervisorPosition,
  latePriorityFrequencyKinds,
  LATE_PRIORITY_FREQUENCY_ORDER,
  type LatePriorityFrequencyKind,
} from "../reviews/late-priority-policy";
import { assignmentRule } from "../flights/schedule-position-rules";

export interface LatePriorityFrequencyCount {
  currentMonthCount: number;
  recentWorkdayCount: number;
}

export interface LatePriorityFrequencyProfile {
  applies: boolean;
  targetKinds: readonly LatePriorityFrequencyKind[];
  supervisorQualified: boolean;
  supervisorRotationDeficit: number;
  counts: Readonly<
    Record<LatePriorityFrequencyKind, LatePriorityFrequencyCount>
  >;
  totalCurrentMonthCount: number;
  totalRecentWorkdayCount: number;
}

function emptyCounts(): Record<
  LatePriorityFrequencyKind,
  LatePriorityFrequencyCount
> {
  return {
    supervisor: { currentMonthCount: 0, recentWorkdayCount: 0 },
    "number-one": { currentMonthCount: 0, recentWorkdayCount: 0 },
    declaration: { currentMonthCount: 0, recentWorkdayCount: 0 },
    delivery: { currentMonthCount: 0, recentWorkdayCount: 0 },
  };
}

const EMPTY_LATE_PRIORITY_FREQUENCY: LatePriorityFrequencyProfile = {
  applies: false,
  targetKinds: [],
  supervisorQualified: false,
  supervisorRotationDeficit: 0,
  counts: emptyCounts(),
  totalCurrentMonthCount: 0,
  totalRecentWorkdayCount: 0,
};

function normalized(value: string): string {
  return value.trim().toUpperCase().replaceAll(/\s+/g, "");
}

function isSupervisorQualifiedForFlight(
  state: AppState,
  staffId: string,
  flightNo: string
): boolean {
  return state.positionRules.some(
    (rule) =>
      rule.category === "常规" &&
      normalized(rule.flightNo) === normalized(flightNo) &&
      isSupervisorPosition(rule) &&
      rule.qualifiedStaffIds.includes(staffId)
  );
}

function isLatePriorityHistoryRecord(
  state: AppState,
  record: HistoryRecord
): boolean {
  return isLatePriorityPosition(
    {
      category: "常规",
      name: record.position,
      remark: record.remark,
    },
    record,
    state.settings.lateShiftEndTime
  );
}

function uniqueDateCount(records: readonly HistoryRecord[]): number {
  return new Set(records.map((record) => record.date)).size;
}

function countForKind(
  records: readonly HistoryRecord[],
  kind: LatePriorityFrequencyKind
): number {
  return uniqueDateCount(
    records.filter((record) =>
      latePriorityFrequencyKinds({
        name: record.position,
        remark: record.remark,
      }).includes(kind)
    )
  );
}

function supervisorCurrentMonthCount(
  state: AppState,
  staffId: string,
  flightNo: string,
  date: string,
  facts: ScheduleFrequencyFacts
): number {
  const month = /^\d{4}-\d{2}/.exec(date)?.[0] ?? "";
  return countForKind(
    (facts.recordsByStaffId.get(staffId) ?? []).filter(
      (record) =>
        record.date < date &&
        record.date.startsWith(month) &&
        normalized(record.flightNo) === normalized(flightNo) &&
        isLatePriorityHistoryRecord(state, record)
    ),
    "supervisor"
  );
}

function supervisorRotationDeficit(
  state: AppState,
  staffId: string,
  flightNo: string,
  date: string,
  facts: ScheduleFrequencyFacts
): number {
  if (!isSupervisorQualifiedForFlight(state, staffId, flightNo)) return 0;
  const supervisorRule = state.positionRules.find(
    (rule) =>
      rule.category === "常规" &&
      normalized(rule.flightNo) === normalized(flightNo) &&
      isSupervisorPosition(rule)
  );
  if (!supervisorRule) return 0;
  const counts = supervisorRule.qualifiedStaffIds.map((qualifiedStaffId) =>
    supervisorCurrentMonthCount(state, qualifiedStaffId, flightNo, date, facts)
  );
  return Math.max(
    0,
    Math.max(0, ...counts) -
      supervisorCurrentMonthCount(state, staffId, flightNo, date, facts)
  );
}

export function latePriorityFrequencyProfileForRule(
  state: AppState,
  staffId: string,
  flight: Pick<Flight, "startTime" | "endTime">,
  rule: Pick<PositionRule, "flightNo" | "category" | "name" | "remark">,
  date: string,
  facts?: ScheduleFrequencyFacts
): LatePriorityFrequencyProfile {
  if (
    !state.settings.positionRotationEnabled ||
    !isLatePriorityPosition(rule, flight, state.settings.lateShiftEndTime)
  )
    return EMPTY_LATE_PRIORITY_FREQUENCY;
  const scheduleFacts =
    facts?.date === date ? facts : createScheduleFrequencyFacts(state, date);
  const currentMonth = /^\d{4}-\d{2}/.exec(date)?.[0] ?? "";
  const matching = (scheduleFacts.recordsByStaffId.get(staffId) ?? []).filter(
    (record) =>
      record.date < date &&
      normalized(record.flightNo) === normalized(rule.flightNo) &&
      isLatePriorityHistoryRecord(state, record)
  );
  const currentMonthRecords = matching.filter((record) =>
    record.date.startsWith(currentMonth)
  );
  const recentRecords = matching.filter((record) =>
    scheduleFacts.recentEightWorkdayRecordIds.has(record.id)
  );
  const counts = emptyCounts();
  for (const kind of LATE_PRIORITY_FREQUENCY_ORDER) {
    counts[kind] = {
      currentMonthCount: countForKind(currentMonthRecords, kind),
      recentWorkdayCount: countForKind(recentRecords, kind),
    };
  }
  return {
    applies: true,
    targetKinds: latePriorityFrequencyKinds(rule),
    supervisorQualified: isSupervisorQualifiedForFlight(
      state,
      staffId,
      rule.flightNo
    ),
    supervisorRotationDeficit: supervisorRotationDeficit(
      state,
      staffId,
      rule.flightNo,
      date,
      scheduleFacts
    ),
    counts,
    totalCurrentMonthCount: currentMonthRecords.length,
    totalRecentWorkdayCount: recentRecords.length,
  };
}

export function isLatePriorityAssignment(
  state: AppState,
  assignment: Assignment
): boolean {
  const rule = assignmentRule(state, assignment);
  return Boolean(
    rule &&
    assignment.status === "assigned" &&
    assignment.staffId &&
    isLatePriorityPosition(rule, assignment, state.settings.lateShiftEndTime)
  );
}

export function latePriorityFrequencyProfileForAssignment(
  state: AppState,
  staffId: string,
  assignment: Assignment,
  date: string,
  facts?: ScheduleFrequencyFacts
): LatePriorityFrequencyProfile {
  const rule = assignmentRule(state, assignment);
  if (!rule) return EMPTY_LATE_PRIORITY_FREQUENCY;
  return latePriorityFrequencyProfileForRule(
    state,
    staffId,
    assignment,
    rule,
    date,
    facts
  );
}

export function latePriorityFrequencyProfileWithSchedule(
  state: AppState,
  staffId: string,
  target: Assignment,
  assignments: readonly Assignment[],
  date: string,
  facts?: ScheduleFrequencyFacts
): LatePriorityFrequencyProfile {
  const historical = latePriorityFrequencyProfileForAssignment(
    state,
    staffId,
    target,
    date,
    facts
  );
  if (!historical.applies) return historical;
  const current = assignments.filter(
    (assignment) =>
      assignment.staffId === staffId &&
      normalized(assignment.flightNo) === normalized(target.flightNo) &&
      isLatePriorityAssignment(state, assignment)
  );
  const counts = emptyCounts();
  for (const kind of LATE_PRIORITY_FREQUENCY_ORDER) {
    counts[kind] = {
      currentMonthCount:
        historical.counts[kind].currentMonthCount +
        current.filter((assignment) => {
          const rule = assignmentRule(state, assignment);
          return Boolean(
            rule && latePriorityFrequencyKinds(rule).includes(kind)
          );
        }).length,
      recentWorkdayCount: historical.counts[kind].recentWorkdayCount,
    };
  }
  return {
    ...historical,
    counts,
    totalCurrentMonthCount: historical.totalCurrentMonthCount + current.length,
  };
}

function fairnessCount(
  profile: LatePriorityFrequencyProfile,
  kind: LatePriorityFrequencyKind,
  period: keyof LatePriorityFrequencyCount
): number {
  const count = profile.counts[kind][period];
  return kind === "declaration" || kind === "delivery"
    ? count + Number(profile.supervisorQualified)
    : count;
}

export function compareLatePriorityFrequencyForKind(
  left: LatePriorityFrequencyProfile,
  right: LatePriorityFrequencyProfile,
  kind: LatePriorityFrequencyKind
): number {
  if (
    !left.applies ||
    !right.applies ||
    !left.targetKinds.includes(kind) ||
    !right.targetKinds.includes(kind)
  )
    return 0;
  if (kind !== "supervisor") {
    const reserveDifference =
      left.supervisorRotationDeficit - right.supervisorRotationDeficit;
    if (reserveDifference) return reserveDifference;
  }
  return (
    fairnessCount(left, kind, "currentMonthCount") -
      fairnessCount(right, kind, "currentMonthCount") ||
    fairnessCount(left, kind, "recentWorkdayCount") -
      fairnessCount(right, kind, "recentWorkdayCount")
  );
}

export function compareLatePriorityFrequency(
  left: LatePriorityFrequencyProfile,
  right: LatePriorityFrequencyProfile
): number {
  if (!left.applies || !right.applies) return 0;
  for (const kind of LATE_PRIORITY_FREQUENCY_ORDER) {
    const difference = compareLatePriorityFrequencyForKind(left, right, kind);
    if (difference) return difference;
  }
  return (
    left.totalCurrentMonthCount - right.totalCurrentMonthCount ||
    left.totalRecentWorkdayCount - right.totalRecentWorkdayCount
  );
}

export function latePriorityFrequencyComparisonValue(
  profile: LatePriorityFrequencyProfile,
  kind: LatePriorityFrequencyKind,
  period: keyof LatePriorityFrequencyCount
): number {
  return fairnessCount(profile, kind, period);
}

export function isTr121NumberOne(
  flightNo: string,
  rule: Pick<PositionRule, "name" | "remark">
): boolean {
  return (
    normalized(flightNo) === "TR121" &&
    latePriorityFrequencyKinds(rule).includes("number-one")
  );
}

export function tr121NumberOneCurrentMonthCount(
  state: AppState,
  staffId: string,
  date: string,
  facts?: ScheduleFrequencyFacts
): number {
  const scheduleFacts =
    facts?.date === date ? facts : createScheduleFrequencyFacts(state, date);
  const month = /^\d{4}-\d{2}/.exec(date)?.[0] ?? "";
  return uniqueDateCount(
    (scheduleFacts.recordsByStaffId.get(staffId) ?? []).filter(
      (record) =>
        record.date < date &&
        record.date.startsWith(month) &&
        normalized(record.flightNo) === "TR121" &&
        latePriorityFrequencyKinds({
          name: record.position,
          remark: record.remark,
        }).includes("number-one")
    )
  );
}

export const TR121_NUMBER_ONE_MONTHLY_AUTOMATIC_LIMIT = 2;

export function exceedsTr121NumberOneAutomaticLimit(
  state: AppState,
  staffId: string,
  flightNo: string,
  rule: Pick<PositionRule, "name" | "remark">,
  date: string,
  facts?: ScheduleFrequencyFacts
): boolean {
  return (
    isTr121NumberOne(flightNo, rule) &&
    tr121NumberOneCurrentMonthCount(state, staffId, date, facts) >=
      TR121_NUMBER_ONE_MONTHLY_AUTOMATIC_LIMIT
  );
}
