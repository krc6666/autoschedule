import type { AppState, Assignment } from "../../model";
import { timeToMinutes } from "../shared/time";

export interface TimedAssignment {
  assignment: Assignment;
  start: number;
  end: number;
}

export interface AssignmentConnection {
  previous: Assignment;
  next: Assignment;
  gap: number;
}

export function conciseNames(names: string[]): string {
  const unique = [...new Set(names)];
  return unique.length <= 3
    ? unique.join("、")
    : `${unique.slice(0, 3).join("、")}等 ${unique.length} 人`;
}

export function operationalStart(startTime: string, state: AppState): number {
  const start = timeToMinutes(startTime);
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  return start < nightEnd ? start + 24 * 60 : start;
}

export function timedAssignments(state: AppState): TimedAssignment[] {
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  return state.assignments
    .filter(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.staffId &&
        assignment.workHours > 0
    )
    .map((assignment) => {
      const rawStart = timeToMinutes(assignment.startTime);
      const rawEnd = timeToMinutes(assignment.endTime);
      let start = rawStart;
      let end = rawEnd <= rawStart ? rawEnd + 24 * 60 : rawEnd;
      if (rawStart < nightEnd) {
        start += 24 * 60;
        end += 24 * 60;
      }
      return { assignment, start, end };
    })
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
}

export function staffConnections(state: AppState): AssignmentConnection[] {
  const timed = timedAssignments(state);
  const staffIds = [
    ...new Set(
      timed
        .map((item) => item.assignment.staffId)
        .filter((staffId): staffId is string => Boolean(staffId))
    ),
  ];
  return staffIds.flatMap((staffId) => {
    const own = timed
      .filter((item) => item.assignment.staffId === staffId)
      .sort((left, right) => left.start - right.start);
    return own
      .slice(1)
      .map((item, index) => ({
        previous: own[index]!.assignment,
        next: item.assignment,
        gap: item.start - own[index]!.end,
      }))
      .filter(
        (connection) =>
          connection.previous.flightId !== connection.next.flightId
      );
  });
}
