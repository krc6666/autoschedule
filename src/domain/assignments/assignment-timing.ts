import type { Assignment, Flight, PositionRule } from "../../model";
import type { AssignmentTimingFacts } from "../shared/scheduling-facts";
import { durationHours, intervalsOverlap, timeToMinutes } from "../shared/time";

export function isValidDiversionTransfer(
  source: Pick<Assignment, "startTime" | "endTime">,
  sourceRule:
    Pick<PositionRule, "category" | "earlyReleaseMinutes"> | undefined,
  target: Pick<Flight, "startTime" | "endTime">
): boolean {
  if (
    sourceRule?.category !== "分流" ||
    sourceRule.earlyReleaseMinutes <= 0 ||
    timeToMinutes(source.startTime) < 12 * 60
  )
    return false;
  const sourceStart = timeToMinutes(source.startTime);
  let sourceEnd = timeToMinutes(source.endTime);
  let targetStart = timeToMinutes(target.startTime);
  if (sourceEnd <= sourceStart) sourceEnd += 24 * 60;
  if (targetStart < sourceStart) targetStart += 24 * 60;
  const overlapMinutes = sourceEnd - targetStart;
  return overlapMinutes > 0 && overlapMinutes <= sourceRule.earlyReleaseMinutes;
}

export function canReleaseForFlight(
  assignment: Assignment,
  flight: Pick<Flight, "startTime" | "endTime">,
  state: AssignmentTimingFacts
): boolean {
  const rule = assignment.positionRuleId
    ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
    : undefined;
  const sourceFlight = state.flights.find(
    (item) => item.id === assignment.flightId
  );
  return isValidDiversionTransfer(sourceFlight ?? assignment, rule, flight);
}

export function isValidAssignmentDiversionTransfer(
  state: AssignmentTimingFacts,
  source: Assignment,
  target: Pick<Flight, "startTime" | "endTime">
): boolean {
  const rule = source.positionRuleId
    ? state.positionRules.find((item) => item.id === source.positionRuleId)
    : undefined;
  const sourceFlight = state.flights.find(
    (item) => item.id === source.flightId
  );
  return isValidDiversionTransfer(sourceFlight ?? source, rule, target);
}

export function staffConflicts(
  assignments: readonly Assignment[],
  staffId: string,
  flight: Pick<Flight, "startTime" | "endTime">
): Assignment[] {
  return assignments.filter(
    (assignment) =>
      assignment.staffId === staffId &&
      intervalsOverlap(
        assignment.startTime,
        assignment.endTime,
        flight.startTime,
        flight.endTime
      )
  );
}

export function projectedAssignedHours(
  assignments: readonly Assignment[],
  staffId: string,
  flight: Pick<Flight, "startTime" | "endTime">,
  state: AssignmentTimingFacts
): number {
  return assignments
    .filter((assignment) => assignment.staffId === staffId)
    .reduce((sum, assignment) => {
      return (
        sum +
        (canReleaseForFlight(assignment, flight, state)
          ? durationHours(assignment.startTime, flight.startTime)
          : assignment.workHours)
      );
    }, 0);
}

export function applyEarlyReleases(
  assignments: Assignment[],
  staffId: string,
  flight: Pick<Flight, "startTime" | "endTime">,
  state: AssignmentTimingFacts
): void {
  staffConflicts(assignments, staffId, flight)
    .filter((assignment) => canReleaseForFlight(assignment, flight, state))
    .forEach((assignment) => {
      assignment.endTime = flight.startTime;
      assignment.workHours = durationHours(
        assignment.startTime,
        assignment.endTime
      );
    });
}

export function applyConfiguredEarlyReleases(
  assignments: Assignment[],
  state: AssignmentTimingFacts,
  staffIds?: ReadonlySet<string>
): void {
  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
    const left = assignments[leftIndex]!;
    if (!left.staffId || (staffIds && !staffIds.has(left.staffId))) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < assignments.length;
      rightIndex += 1
    ) {
      const right = assignments[rightIndex]!;
      if (right.staffId !== left.staffId) continue;
      if (canReleaseForFlight(left, right, state)) {
        left.endTime = right.startTime;
        left.workHours = durationHours(left.startTime, left.endTime);
      } else if (canReleaseForFlight(right, left, state)) {
        right.endTime = left.startTime;
        right.workHours = durationHours(right.startTime, right.endTime);
      }
    }
  }
}

export function applyEarlyReleaseForStaff(
  state: AssignmentTimingFacts,
  assignmentId: string,
  staffId: string
): void {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  const others = state.assignments.filter((item) => item.id !== assignmentId);
  applyEarlyReleases(others, staffId, assignment, state);
}

export function isDiversionTransfer(
  state: AssignmentTimingFacts,
  sourceAssignmentId: string,
  targetAssignmentId: string
): boolean {
  const source = state.assignments.find(
    (item) => item.id === sourceAssignmentId
  );
  const target = state.assignments.find(
    (item) => item.id === targetAssignmentId
  );
  return Boolean(
    source && target && canReleaseForFlight(source, target, state)
  );
}
