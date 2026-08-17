import type { Assignment, PositionRule, Staff } from "../../model";
import type {
  AssignmentEligibilityDiagnostic,
  AutomaticAssignmentEligibilityOptions,
} from "../candidates/assignment-eligibility";
import { assignmentRule } from "../flights/schedule-position-rules";
import type { AssignmentTask } from "../flights/schedule-tasks";
import { isPreNoonFlight } from "../flights/schedule-tasks";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";

export interface MorningReallocation {
  person: Staff;
  source: Assignment;
}

export function findMorningReallocation(
  state: ScheduleGenerationFacts,
  assignments: Assignment[],
  task: AssignmentTask,
  workHours: number,
  eligibleCounts: ReadonlyMap<string, number>,
  evaluateEligibility: (
    context: AutomaticAssignmentEligibilityOptions
  ) => AssignmentEligibilityDiagnostic
): MorningReallocation | undefined {
  return assignments
    .filter(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.staffId &&
        assignment.flightId !== task.flight.id &&
        isPreNoonFlight(assignment)
    )
    .map((assignment) => ({
      assignment,
      sourceRule: assignmentRule(state, assignment),
      person: state.staff.find((person) => person.id === assignment.staffId),
    }))
    .filter(
      (
        item
      ): item is typeof item & {
        person: Staff;
        sourceRule: PositionRule;
      } => Boolean(item.person && item.sourceRule?.category === "常规")
    )
    .filter(
      (item) =>
        evaluateEligibility({
          state,
          assignments: assignments.filter(
            (assignment) => assignment.id !== item.assignment.id
          ),
          flight: task.flight,
          rule: task.rule,
          person: item.person,
          workHours,
        }).eligible
    )
    .sort(
      (left, right) =>
        (eligibleCounts.get(
          `${right.assignment.flightId}:${right.sourceRule.id}`
        ) ?? 0) -
          (eligibleCounts.get(
            `${left.assignment.flightId}:${left.sourceRule.id}`
          ) ?? 0) ||
        left.assignment.startTime.localeCompare(right.assignment.startTime)
    )
    .map((item) => ({ person: item.person, source: item.assignment }))[0];
}
