import type { Assignment } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "../assignments/assignment-evidence";
import { lateShiftRecoveryRisk } from "./schedule-protection";
import { assignmentRule } from "../flights/schedule-position-rules";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import {
  isRotationLocked,
  rotationCandidateAssignments,
  type RotationStaffChange,
} from "./rotation-review-safety";
import { optimizeReassignment } from "../solver/reassignment-optimizer";
import type { SolverPort } from "../solver/solver-port";
import { assignmentWarningMessage } from "./schedule-warning-message";
import { halfRestBackfillRejectionReason } from "../rules/half-rest";

function applyRecoveryPlan(
  state: ScheduleGenerationFacts,
  assignments: Assignment[],
  primary: Assignment,
  changes: readonly RotationStaffChange[]
): void {
  const originalName = primary.staffName;
  const originalFlightNo = primary.flightNo;
  const originalPosition = primary.position;
  const changedAssignments: Assignment[] = [];
  for (const change of changes) {
    const assignment = assignments.find(
      (item) => item.id === change.assignmentId
    );
    const person = state.staff.find((item) => item.id === change.staffId);
    if (!assignment || !person) continue;
    assignment.staffId = person.id;
    assignment.staffName = person.name;
    changedAssignments.push(assignment);
  }
  const participants =
    new Set(changedAssignments.flatMap((assignment) => [assignment.staffId]))
      .size + 1;
  const message = `${originalName}原在${originalFlightNo}/${originalPosition}，现已通过${participants}人整体安全重排避开跨工作日恢复冲突。`;
  changedAssignments.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("late-shift-recovery", "selected", message),
    ]);
  });
}

function recoveryFallback(primary: Assignment, reasons: string[]): string {
  return assignmentWarningMessage({
    staffName: primary.staffName,
    fact: `上一班需要恢复，本班仍承担${primary.flightNo}/${primary.position}`,
    reasons,
  });
}

export async function reviewLateShiftRecovery(
  solver: SolverPort,
  state: ScheduleGenerationFacts,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): Promise<string[]> {
  if (!state.settings.lateShiftRecoveryEnabled) return [];
  const reviewed = new Set<string>();
  const warnings: string[] = [];
  const protectedAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .filter((assignment) => {
      const flight = state.flights.find(
        (item) => item.id === assignment.flightId
      );
      const rule = assignmentRule(state, assignment);
      return Boolean(
        flight &&
        rule &&
        lateShiftRecoveryRisk(
          state,
          assignment.staffId!,
          {
            ...flight,
            position: assignment.position,
            remark: assignment.remark,
            fatiguePoints: assignment.fatiguePoints,
          },
          date,
          facts?.crossDayRecovery
        ).excess > 0
      );
    })
    .sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) ||
        left.flightNo.localeCompare(right.flightNo) ||
        left.position.localeCompare(right.position)
    );

  for (const primary of protectedAssignments) {
    if (reviewed.has(primary.id)) continue;
    const attemptedReasons = (primary.decisionTrace ?? [])
      .filter(
        (decision) =>
          decision.ruleId === "late-shift-recovery" &&
          decision.outcome === "fallback"
      )
      .map((decision) => decision.message)
      .filter(Boolean);
    const flight = state.flights.find((item) => item.id === primary.flightId)!;
    const result = await optimizeReassignment({
      solver,
      state,
      assignments,
      primary,
      movableAssignments: rotationCandidateAssignments(
        assignments,
        primary,
        state,
        lockedAssignmentIds
      ).filter((assignment) => !reviewed.has(assignment.id)),
      date,
      review: "recovery",
      facts,
      primaryCandidateAllowed: (person) =>
        lateShiftRecoveryRisk(
          state,
          person.id,
          {
            ...flight,
            position: primary.position,
            remark: primary.remark,
            fatiguePoints: primary.fatiguePoints,
          },
          date,
          facts?.crossDayRecovery
        ).excess === 0,
      maxParticipants: 3,
    });
    attemptedReasons.push(...result.attemptedReasons);
    if (result.changes) {
      applyRecoveryPlan(state, assignments, primary, result.changes);
      result.changes.forEach((change) => reviewed.add(change.assignmentId));
      continue;
    }
    reviewed.add(primary.id);
    const halfRestReason = facts
      ? halfRestBackfillRejectionReason({
          state,
          target: primary,
          facts: facts.halfRest,
        })
      : null;
    const message = recoveryFallback(primary, [
      ...attemptedReasons,
      ...(halfRestReason ? [halfRestReason] : []),
    ]);
    replaceAssignmentDecisions(primary, "late-shift-recovery", [
      schedulingDecision("late-shift-recovery", "fallback", message),
    ]);
    warnings.push(message);
  }
  return warnings;
}
