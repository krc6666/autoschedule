import type { AppState, Assignment, Flight } from "../model";
import { durationHours, intervalsOverlap, timeToMinutes } from "./time";

export function canReleaseForFlight(
  assignment: Assignment,
  flight: Pick<Flight, "startTime" | "endTime">,
  state: AppState
): boolean {
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  if (rule?.category !== "分流" || rule.earlyReleaseMinutes <= 0 || timeToMinutes(assignment.startTime) < 12 * 60) return false;
  const assignmentStart = timeToMinutes(assignment.startTime);
  let assignmentEnd = timeToMinutes(assignment.endTime);
  let nextStart = timeToMinutes(flight.startTime);
  if (assignmentEnd <= assignmentStart) assignmentEnd += 24 * 60;
  if (nextStart < assignmentStart) nextStart += 24 * 60;
  const overlapMinutes = assignmentEnd - nextStart;
  return overlapMinutes > 0 && overlapMinutes <= rule.earlyReleaseMinutes;
}

export function staffConflicts(
  assignments: Assignment[],
  staffId: string,
  flight: Pick<Flight, "startTime" | "endTime">
): Assignment[] {
  return assignments.filter((assignment) => assignment.staffId === staffId
    && intervalsOverlap(assignment.startTime, assignment.endTime, flight.startTime, flight.endTime));
}

export function projectedAssignedHours(
  assignments: Assignment[],
  staffId: string,
  flight: Pick<Flight, "startTime" | "endTime">,
  state: AppState
): number {
  return assignments.filter((assignment) => assignment.staffId === staffId).reduce((sum, assignment) => {
    return sum + (canReleaseForFlight(assignment, flight, state)
      ? durationHours(assignment.startTime, flight.startTime)
      : assignment.workHours);
  }, 0);
}

export function applyEarlyReleases(
  assignments: Assignment[],
  staffId: string,
  flight: Pick<Flight, "startTime" | "endTime">,
  state: AppState
): void {
  staffConflicts(assignments, staffId, flight)
    .filter((assignment) => canReleaseForFlight(assignment, flight, state))
    .forEach((assignment) => {
      assignment.endTime = flight.startTime;
      assignment.workHours = durationHours(assignment.startTime, assignment.endTime);
    });
}
