import type { Assignment } from "../../model";
import type { HistoryRuleFacts } from "../shared/scheduling-facts";
import type { CrossFlightPriorityPolicy } from "./structured-policy-contract";
import { intervalsOverlap } from "../shared/time";
import {
  comparePositionFrequency,
  consecutivePositionAssignments,
  samePositionFrequencyProfile,
  type ScheduleFrequencyFacts,
} from "../statistics/schedule-frequency";

function normalizePosition(value: string): string {
  return value.trim().replace(/^HO(?=\d)/i, "H0");
}

export function enabledCrossFlightPriorityPolicies(state: HistoryRuleFacts) {
  return state.settings.crossFlightPriorityPolicies.filter(
    (policy) =>
      policy.enabled && policy.flightNo.trim() && policy.positions.length
  );
}

export function isCrossFlightPriorityAssignment(
  state: HistoryRuleFacts,
  assignment: Pick<Assignment, "flightNo" | "position">
): boolean {
  const flightNo = assignment.flightNo.trim().toUpperCase();
  const position = normalizePosition(assignment.position);
  return enabledCrossFlightPriorityPolicies(state).some((policy) =>
    crossFlightPriorityPolicyMatches(policy, { flightNo, position })
  );
}

export function crossFlightPriorityPolicyMatches(
  policy: CrossFlightPriorityPolicy,
  assignment: Pick<Assignment, "flightNo" | "position">
): boolean {
  const flightNo = assignment.flightNo.trim().toUpperCase();
  const position = normalizePosition(assignment.position);
  return (
    policy.flightNo === flightNo &&
    policy.positions.some((item) => normalizePosition(item) === position)
  );
}

export function crossFlightPriorityReassignmentReasons(
  state: HistoryRuleFacts,
  original: readonly Assignment[],
  planned: readonly Assignment[],
  date: string,
  frequencyFacts?: ScheduleFrequencyFacts
): string[] {
  const reasons: string[] = [];
  for (const policy of enabledCrossFlightPriorityPolicies(state)) {
    const protectedOriginal = original.filter(
      (assignment) =>
        assignment.staffId &&
        assignment.flightNo.trim().toUpperCase() === policy.flightNo &&
        policy.positions.some(
          (position) =>
            normalizePosition(position) ===
            normalizePosition(assignment.position)
        )
    );
    for (const before of protectedOriginal) {
      const after = planned.find((assignment) => assignment.id === before.id);
      if (!after || after.staffId === before.staffId || !before.staffId)
        continue;
      const replacement = planned.find(
        (assignment) =>
          assignment.staffId === before.staffId && assignment.id !== before.id
      );
      if (!replacement) continue;
      if (
        !intervalsOverlap(
          replacement.startTime,
          replacement.endTime,
          before.startTime,
          before.endTime
        )
      )
        continue;
      if (!after.staffId) continue;
      const beforeFrequency = samePositionFrequencyProfile(
        state,
        before.staffId,
        before.flightNo,
        before.position,
        date,
        frequencyFacts
      );
      const afterFrequency = samePositionFrequencyProfile(
        state,
        after.staffId,
        before.flightNo,
        before.position,
        date,
        frequencyFacts
      );
      const frequencyDifference = comparePositionFrequency(
        afterFrequency,
        beforeFrequency
      );
      const beforeConsecutive = consecutivePositionAssignments(
        state,
        before.staffId,
        before.flightNo,
        before.position,
        date,
        frequencyFacts
      );
      const afterConsecutive = consecutivePositionAssignments(
        state,
        after.staffId,
        before.flightNo,
        before.position,
        date,
        frequencyFacts
      );
      if (
        frequencyDifference < 0 ||
        (frequencyDifference === 0 && afterConsecutive <= beforeConsecutive)
      )
        continue;
      reasons.push(`调整会破坏${policy.flightNo}重点岗位轮换，优先保留原人员`);
    }
  }
  return [...new Set(reasons)];
}

export function crossFlightPriorityCandidateScore(
  state: HistoryRuleFacts,
  assignment: Pick<Assignment, "flightNo" | "position">
): number {
  return isCrossFlightPriorityAssignment(state, assignment) ? 1 : 0;
}
