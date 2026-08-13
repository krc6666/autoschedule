import type {
  AppState,
  Assignment,
  Flight,
  PositionRule,
  Staff,
} from "../../model";
import {
  isValidAssignmentDiversionTransfer,
  isValidDiversionTransfer,
  projectedAssignedHours,
  staffConflicts,
} from "../assignments/assignment-timing";
import { isReusableAssignment } from "../flights/schedule-position-rules";
import { durationHours, isNightInterval } from "../shared/time";

export interface StaffAssignmentFacts {
  available: boolean;
  regularStaff: boolean;
  positionQualified: boolean;
  nightAssignment: boolean;
  nightCapable: boolean;
}

export type SameFlightConflict = "block" | "allow-reusable" | "allow-all";

export interface AssignmentLoadFactsOptions {
  state: AppState;
  assignments: readonly Assignment[];
  flight: Pick<Flight, "id" | "startTime" | "endTime">;
  rule?: PositionRule;
  person: Staff;
  workHours?: number;
  sameFlightConflict?: SameFlightConflict;
}

export interface AssignmentLoadFacts {
  blockingConflicts: Assignment[];
  projectedHours: number;
  withinDailyHours: boolean;
}

export type AssignmentConflictFacts = Pick<
  AssignmentLoadFacts,
  "blockingConflicts"
>;

export type AssignmentHoursFacts = Pick<
  AssignmentLoadFacts,
  "projectedHours" | "withinDailyHours"
>;

export function staffAssignmentFacts(
  state: AppState,
  flight: Pick<Flight, "startTime" | "endTime">,
  rule: PositionRule,
  person: Staff
): StaffAssignmentFacts {
  const nightAssignment = isNightInterval(
    flight.startTime,
    flight.endTime,
    state.settings.nightStart,
    state.settings.nightEnd
  );
  return {
    available: person.status === "正常",
    regularStaff: person.staffType === "常规",
    positionQualified: rule.qualifiedStaffIds.includes(person.id),
    nightAssignment,
    nightCapable: !nightAssignment || person.nightShift,
  };
}

export function assignmentConflictFacts({
  state,
  assignments,
  flight,
  rule,
  person,
  sameFlightConflict = "block",
}: AssignmentLoadFactsOptions): AssignmentConflictFacts {
  const blockingConflicts = staffConflicts(
    assignments,
    person.id,
    flight
  ).filter((assignment) => {
    if (assignment.flightId === flight.id) {
      if (sameFlightConflict === "allow-all") return false;
      if (
        sameFlightConflict === "allow-reusable" &&
        isReusableAssignment(state, assignment)
      )
        return false;
    }
    return !(
      isValidAssignmentDiversionTransfer(state, assignment, flight) ||
      isValidDiversionTransfer(flight, rule, assignment)
    );
  });
  return { blockingConflicts };
}

export function assignmentHoursFacts({
  state,
  assignments,
  flight,
  person,
  workHours = durationHours(flight.startTime, flight.endTime),
}: AssignmentLoadFactsOptions): AssignmentHoursFacts {
  const projectedHours =
    projectedAssignedHours(assignments, person.id, flight, state) + workHours;
  return {
    projectedHours,
    withinDailyHours: projectedHours <= state.settings.maxDailyHours,
  };
}

export function assignmentLoadFacts(
  options: AssignmentLoadFactsOptions
): AssignmentLoadFacts {
  return {
    ...assignmentConflictFacts(options),
    ...assignmentHoursFacts(options),
  };
}
