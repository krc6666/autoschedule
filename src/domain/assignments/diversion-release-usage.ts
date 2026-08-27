import type { Assignment, Flight, PositionRule } from "../../model";
import type { AssignmentTimingFacts } from "../shared/scheduling-facts";
import { intervalsOverlap } from "../shared/time";
import { isValidDiversionTransfer } from "./assignment-timing";
import { minimumFlightTransitionViolationBetweenTasks } from "./minimum-flight-transition";

function withoutDiversion(rule: PositionRule): PositionRule {
  return { ...rule, category: "常规", earlyReleaseMinutes: 0 };
}

export function tasksRequireDiversionRelease(
  state: AssignmentTimingFacts,
  leftFlight: Flight,
  leftRule: PositionRule,
  rightFlight: Flight,
  rightRule: PositionRule
): boolean {
  const currentConflict =
    minimumFlightTransitionViolationBetweenTasks(
      state,
      leftFlight,
      leftRule,
      rightFlight,
      rightRule
    ) !== null ||
    (intervalsOverlap(
      leftFlight.startTime,
      leftFlight.endTime,
      rightFlight.startTime,
      rightFlight.endTime
    ) &&
      !isValidDiversionTransfer(leftFlight, leftRule, rightFlight) &&
      !isValidDiversionTransfer(rightFlight, rightRule, leftFlight));
  if (currentConflict) return false;
  return (
    intervalsOverlap(
      leftFlight.startTime,
      leftFlight.endTime,
      rightFlight.startTime,
      rightFlight.endTime
    ) ||
    minimumFlightTransitionViolationBetweenTasks(
      state,
      leftFlight,
      withoutDiversion(leftRule),
      rightFlight,
      withoutDiversion(rightRule)
    ) !== null
  );
}

function diversionTransferPairs(
  assignments: readonly Assignment[],
  state: AssignmentTimingFacts
): Array<readonly [string, string]> {
  const pairs: Array<readonly [string, string]> = [];
  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
    const left = assignments[leftIndex]!;
    if (!left.staffId || left.status !== "assigned") continue;
    const leftFlight = state.flights.find(
      (flight) => flight.id === left.flightId
    );
    const leftRule = state.positionRules.find(
      (rule) => rule.id === left.positionRuleId
    );
    if (!leftFlight || !leftRule) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < assignments.length;
      rightIndex += 1
    ) {
      const right = assignments[rightIndex]!;
      if (right.staffId !== left.staffId || right.status !== "assigned")
        continue;
      const rightFlight = state.flights.find(
        (flight) => flight.id === right.flightId
      );
      const rightRule = state.positionRules.find(
        (rule) => rule.id === right.positionRuleId
      );
      if (
        rightFlight &&
        rightRule &&
        tasksRequireDiversionRelease(
          state,
          leftFlight,
          leftRule,
          rightFlight,
          rightRule
        )
      ) {
        pairs.push([left.id, right.id]);
      }
    }
  }
  return pairs;
}

export function diversionTransferCount(
  assignments: readonly Assignment[],
  state: AssignmentTimingFacts
): number {
  return diversionTransferPairs(assignments, state).length;
}

export function diversionTransferAssignmentIds(
  assignments: readonly Assignment[],
  state: AssignmentTimingFacts
): ReadonlySet<string> {
  return new Set(diversionTransferPairs(assignments, state).flat());
}
