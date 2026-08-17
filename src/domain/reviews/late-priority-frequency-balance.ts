import type { Assignment, Staff } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { eligibleStaffForRule } from "../candidates/assignment-eligibility";
import { assignmentRule } from "../flights/schedule-position-rules";
import {
  compareLatePriorityAggregate,
  compareLatePriorityFrequencyForKind,
  isLatePriorityAssignment,
  latePriorityFrequencyComparisonValue,
  latePriorityFrequencyProfileWithSchedule,
  type LatePriorityFrequencyProfile,
} from "../statistics/late-priority-frequency";
import type { ScheduleFrequencyFacts } from "../statistics/schedule-frequency";
import {
  latePriorityKindLabel,
  latePriorityFrequencyKinds,
  LATE_PRIORITY_ALLOWED_DIFFERENCE,
  LATE_PRIORITY_FREQUENCY_ORDER,
  type LatePriorityFrequencyKind,
} from "./late-priority-policy";

export interface LatePriorityBalancePeriod {
  label: string;
  assignedCount: number;
  difference: number;
}

export interface LatePriorityBalanceAssessment {
  kind: LatePriorityFrequencyKind;
  eligibleStaff: readonly Staff[];
  lowestStaffIds: ReadonlySet<string>;
  assignedProfile: LatePriorityFrequencyProfile;
  periods: readonly LatePriorityBalancePeriod[];
  maximumDifference: number;
  needsAttention: boolean;
}

export interface LatePriorityAggregateAssessment {
  eligibleStaff: readonly Staff[];
  preferredStaffIds: ReadonlySet<string>;
  assignedProfile: LatePriorityFrequencyProfile;
  previousWorkdayAssigned: boolean;
  needsAttention: boolean;
}

function projectedAssignments(
  assignments: readonly Assignment[],
  assignmentId: string,
  staff: Staff
): Assignment[] {
  return assignments.map((assignment) =>
    assignment.id === assignmentId
      ? { ...assignment, staffId: staff.id, staffName: staff.name }
      : assignment
  );
}

function eligibleProfiles(
  state: ScheduleGenerationFacts,
  target: Assignment,
  assignments: readonly Assignment[],
  date: string,
  facts?: ScheduleFrequencyFacts
): Array<{ person: Staff; profile: LatePriorityFrequencyProfile }> {
  const flight = state.flights.find((item) => item.id === target.flightId);
  const rule = assignmentRule(state, target);
  if (!flight || !rule) return [];
  return eligibleStaffForRule(state, flight, rule).map((person) => ({
    person,
    profile: latePriorityFrequencyProfileWithSchedule(
      state,
      person.id,
      target,
      assignments,
      date,
      facts
    ),
  }));
}

function spread(values: readonly number[]): number {
  return values.length ? Math.max(...values) - Math.min(...values) : 0;
}

function period(
  profiles: readonly LatePriorityFrequencyProfile[],
  assigned: LatePriorityFrequencyProfile,
  kind: LatePriorityFrequencyKind,
  periodKey: "currentMonthCount" | "recentWorkdayCount",
  labelPrefix: string
): LatePriorityBalancePeriod {
  return {
    label: `${labelPrefix}跨航班${latePriorityKindLabel(kind)}`,
    assignedCount: latePriorityFrequencyComparisonValue(
      assigned,
      kind,
      periodKey
    ),
    difference: spread(
      profiles.map((profile) =>
        latePriorityFrequencyComparisonValue(profile, kind, periodKey)
      )
    ),
  };
}

export function assessLatePriorityFrequencyBalance(
  state: ScheduleGenerationFacts,
  assignment: Assignment,
  assignments: readonly Assignment[],
  date: string,
  facts?: ScheduleFrequencyFacts,
  requestedKind?: LatePriorityFrequencyKind
): LatePriorityBalanceAssessment | null {
  if (!assignment.staffId || !isLatePriorityAssignment(state, assignment))
    return null;
  const rule = assignmentRule(state, assignment);
  if (!rule) return null;
  const targetKinds = latePriorityFrequencyKinds(rule);
  const kind = requestedKind ?? targetKinds[0];
  if (!kind || !targetKinds.includes(kind)) return null;
  const currentProfiles = eligibleProfiles(
    state,
    assignment,
    assignments,
    date,
    facts
  );
  const beforeProfiles = eligibleProfiles(
    state,
    assignment,
    assignments.filter((item) => item.id !== assignment.id),
    date,
    facts
  );
  const assigned = currentProfiles.find(
    (item) => item.person.id === assignment.staffId
  );
  if (!assigned || !currentProfiles.length || !beforeProfiles.length)
    return null;
  const minimumCount = Math.min(
    ...beforeProfiles.map((item) => item.profile.counts[kind].currentMonthCount)
  );
  const lowestStaffIds = new Set(
    beforeProfiles
      .filter(
        (item) => item.profile.counts[kind].currentMonthCount === minimumCount
      )
      .map((item) => item.person.id)
  );
  const profiles = currentProfiles.map((item) => item.profile);
  const periods = [
    period(profiles, assigned.profile, kind, "currentMonthCount", "本月"),
    period(
      profiles,
      assigned.profile,
      kind,
      "recentWorkdayCount",
      "最近8个归档工作班"
    ),
  ];
  const maximumDifference = Math.max(
    0,
    ...periods.map((item) => item.difference)
  );
  return {
    kind,
    eligibleStaff: currentProfiles.map((item) => item.person),
    lowestStaffIds,
    assignedProfile: assigned.profile,
    periods,
    maximumDifference,
    needsAttention:
      maximumDifference > LATE_PRIORITY_ALLOWED_DIFFERENCE[kind] &&
      !lowestStaffIds.has(assignment.staffId),
  };
}

export function assessLatePriorityAggregateBalance(
  state: ScheduleGenerationFacts,
  assignment: Assignment,
  assignments: readonly Assignment[],
  date: string,
  facts?: ScheduleFrequencyFacts
): LatePriorityAggregateAssessment | null {
  if (!assignment.staffId || !isLatePriorityAssignment(state, assignment))
    return null;
  const currentProfiles = eligibleProfiles(
    state,
    assignment,
    assignments,
    date,
    facts
  );
  const beforeProfiles = eligibleProfiles(
    state,
    assignment,
    assignments.filter((item) => item.id !== assignment.id),
    date,
    facts
  );
  const assigned = currentProfiles.find(
    (item) => item.person.id === assignment.staffId
  );
  const assignedBefore = beforeProfiles.find(
    (item) => item.person.id === assignment.staffId
  );
  if (!assigned || !assignedBefore || !beforeProfiles.length) return null;
  const preferred = [...beforeProfiles].sort((left, right) =>
    compareLatePriorityAggregate(left.profile, right.profile)
  )[0]!.profile;
  const preferredStaffIds = new Set(
    beforeProfiles
      .filter(
        (item) => compareLatePriorityAggregate(item.profile, preferred) === 0
      )
      .map((item) => item.person.id)
  );
  return {
    eligibleStaff: beforeProfiles.map((item) => item.person),
    preferredStaffIds,
    assignedProfile: assigned.profile,
    previousWorkdayAssigned: assignedBefore.profile.previousWorkdayAssigned,
    needsAttention: !preferredStaffIds.has(assignment.staffId),
  };
}

export function compareProjectedLatePriorityCandidates(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  assignment: Assignment,
  left: Staff,
  right: Staff,
  date: string,
  kind: LatePriorityFrequencyKind,
  facts?: ScheduleFrequencyFacts
): number {
  return (
    compareLatePriorityFrequencyForKind(
      latePriorityFrequencyProfileWithSchedule(
        state,
        left.id,
        assignment,
        projectedAssignments(assignments, assignment.id, left),
        date,
        facts
      ),
      latePriorityFrequencyProfileWithSchedule(
        state,
        right.id,
        assignment,
        projectedAssignments(assignments, assignment.id, right),
        date,
        facts
      ),
      kind
    ) || left.id.localeCompare(right.id, undefined, { numeric: true })
  );
}

export function compareProjectedLatePriorityAggregateCandidates(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  assignment: Assignment,
  left: Staff,
  right: Staff,
  date: string,
  facts?: ScheduleFrequencyFacts
): number {
  return (
    compareLatePriorityAggregate(
      latePriorityFrequencyProfileWithSchedule(
        state,
        left.id,
        assignment,
        projectedAssignments(assignments, assignment.id, left),
        date,
        facts
      ),
      latePriorityFrequencyProfileWithSchedule(
        state,
        right.id,
        assignment,
        projectedAssignments(assignments, assignment.id, right),
        date,
        facts
      )
    ) || left.id.localeCompare(right.id, undefined, { numeric: true })
  );
}

function aggregateQualityVector(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  date: string,
  facts?: ScheduleFrequencyFacts
): number[] {
  const profiles = assignments.flatMap((assignment) =>
    assignment.staffId && isLatePriorityAssignment(state, assignment)
      ? [
          latePriorityFrequencyProfileWithSchedule(
            state,
            assignment.staffId,
            assignment,
            assignments,
            date,
            facts
          ),
        ]
      : []
  );
  const monthly = profiles.map((profile) => profile.totalCurrentMonthCount);
  const recent = profiles.map((profile) => profile.totalRecentWorkdayCount);
  return [
    profiles.filter((profile) => profile.previousWorkdayAssigned).length,
    Math.max(0, ...monthly),
    monthly.reduce((sum, count) => sum + count * count, 0),
    Math.max(0, ...recent),
    recent.reduce((sum, count) => sum + count * count, 0),
  ];
}

function assignmentSpreads(
  state: ScheduleGenerationFacts,
  assignment: Assignment,
  assignments: readonly Assignment[],
  date: string,
  facts?: ScheduleFrequencyFacts
): number[] {
  const profiles = eligibleProfiles(
    state,
    assignment,
    assignments,
    date,
    facts
  ).map((item) => item.profile);
  const rule = assignmentRule(state, assignment);
  if (!profiles.length || !rule) return [];
  const targetKinds = latePriorityFrequencyKinds(rule);
  return LATE_PRIORITY_FREQUENCY_ORDER.flatMap((kind) =>
    targetKinds.includes(kind)
      ? [
          spread(
            profiles.map((profile) =>
              latePriorityFrequencyComparisonValue(
                profile,
                kind,
                "currentMonthCount"
              )
            )
          ),
          spread(
            profiles.map((profile) =>
              latePriorityFrequencyComparisonValue(
                profile,
                kind,
                "recentWorkdayCount"
              )
            )
          ),
        ]
      : []
  );
}

function worsensFrequencyPriority(
  before: readonly number[],
  after: readonly number[]
): boolean {
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    const beforeDifference = before[index] ?? 0;
    const afterDifference = after[index] ?? 0;
    if (afterDifference < beforeDifference) return false;
    if (afterDifference > beforeDifference) return true;
  }
  return false;
}

export function latePriorityFrequencyRegressionReasons(
  state: ScheduleGenerationFacts,
  before: readonly Assignment[],
  after: readonly Assignment[],
  date: string,
  facts?: ScheduleFrequencyFacts
): string[] {
  if (
    worsensFrequencyPriority(
      aggregateQualityVector(state, before, date, facts),
      aggregateQualityVector(state, after, date, facts)
    )
  ) {
    return ["调整会增加末班重点岗位连续承担或扩大四类合计负担"];
  }
  const originals = before
    .filter((assignment) => isLatePriorityAssignment(state, assignment))
    .sort((left, right) => {
      const leftRule = assignmentRule(state, left);
      const rightRule = assignmentRule(state, right);
      const leftKind = leftRule
        ? latePriorityFrequencyKinds(leftRule)[0]
        : undefined;
      const rightKind = rightRule
        ? latePriorityFrequencyKinds(rightRule)[0]
        : undefined;
      return (
        (leftKind ? LATE_PRIORITY_FREQUENCY_ORDER.indexOf(leftKind) : 99) -
          (rightKind ? LATE_PRIORITY_FREQUENCY_ORDER.indexOf(rightKind) : 99) ||
        left.id.localeCompare(right.id)
      );
    });
  for (const original of originals) {
    const planned = after.find((assignment) => assignment.id === original.id);
    if (!planned) continue;
    const beforeSpreads = assignmentSpreads(
      state,
      original,
      before,
      date,
      facts
    );
    const afterSpreads = assignmentSpreads(state, planned, after, date, facts);
    if (worsensFrequencyPriority(beforeSpreads, afterSpreads)) {
      return ["调整会扩大更高优先级末班岗位次数差"];
    }
  }
  return [];
}
