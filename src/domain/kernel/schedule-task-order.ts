import type { Flight, PositionRule } from "../../model";
import { isPriorityRotationPosition } from "../reviews/position-rotation-policy";
import {
  mustAutoFillPreNoon,
  type AssignmentTask,
} from "../flights/schedule-tasks";
import { timeToMinutes } from "../shared/time";

export function orderPreNoonTasks(
  tasks: readonly AssignmentTask[],
  eligibleCounts: ReadonlyMap<string, number>,
  displayRulesByFlight: ReadonlyMap<string, readonly PositionRule[]>
): AssignmentTask[] {
  return tasks
    .filter((task) => mustAutoFillPreNoon(task.flight, task.rule))
    .sort(
      (left, right) =>
        (eligibleCounts.get(left.key) ?? 0) -
          (eligibleCounts.get(right.key) ?? 0) ||
        Number(isPriorityRotationPosition(right.rule)) -
          Number(isPriorityRotationPosition(left.rule)) ||
        timeToMinutes(left.flight.startTime) -
          timeToMinutes(right.flight.startTime) ||
        (displayRulesByFlight
          .get(left.flight.id)
          ?.findIndex((rule) => rule.id === left.rule.id) ?? 0) -
          (displayRulesByFlight
            .get(right.flight.id)
            ?.findIndex((rule) => rule.id === right.rule.id) ?? 0) ||
        left.key.localeCompare(right.key)
    );
}

export function orderFlightRules(
  flight: Flight,
  displayRules: readonly PositionRule[],
  eligibleCounts: ReadonlyMap<string, number>,
  dutyTargetTaskKeys: ReadonlySet<string>
): PositionRule[] {
  const displayIndex = new Map(
    displayRules.map((rule, index) => [rule.id, index])
  );
  return displayRules
    .filter((rule) => !mustAutoFillPreNoon(flight, rule))
    .filter((rule) => rule.category !== "引导" && rule.category !== "行政支援")
    .sort((left, right) => {
      const leftKey = `${flight.id}:${left.id}`;
      const rightKey = `${flight.id}:${right.id}`;
      if (dutyTargetTaskKeys.has(leftKey) || dutyTargetTaskKeys.has(rightKey))
        return dutyTargetTaskKeys.has(leftKey) ? -1 : 1;
      const leftDeferred =
        left.manual || (left.minPassengers ?? 0) > flight.bookedPassengers;
      const rightDeferred =
        right.manual || (right.minPassengers ?? 0) > flight.bookedPassengers;
      if (leftDeferred !== rightDeferred) return leftDeferred ? 1 : -1;
      return (
        (eligibleCounts.get(leftKey) ?? Number.MAX_SAFE_INTEGER) -
          (eligibleCounts.get(rightKey) ?? Number.MAX_SAFE_INTEGER) ||
        Number(isPriorityRotationPosition(right)) -
          Number(isPriorityRotationPosition(left)) ||
        (displayIndex.get(left.id) ?? 0) - (displayIndex.get(right.id) ?? 0)
      );
    })
    .concat(displayRules.filter((rule) => rule.category === "引导"))
    .concat(displayRules.filter((rule) => rule.category === "行政支援"));
}
