import type { AppState, Assignment } from "../../model";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "../assignments/assignment-evidence";
import {
  isNextDutyRestConflict,
  nextDutyRestProtection,
} from "./next-duty-rest";
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

function applyRestPlan(
  state: AppState,
  assignments: Assignment[],
  primary: Assignment,
  changes: readonly RotationStaffChange[],
  nextWorkdayDate: string
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
  const message = `${originalName}下个工作班${nextWorkdayDate}值班，已通过整体安全重排退出${originalFlightNo}/${originalPosition}，预休保护已落实。`;
  changedAssignments.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("next-duty-rest", "selected", message),
    ]);
  });
}

function restFallback(
  primary: Assignment,
  nextWorkdayDate: string,
  reasons: string[]
): string {
  return assignmentWarningMessage({
    staffName: primary.staffName,
    fact: `将在${nextWorkdayDate}值班，本班仍承担${primary.flightNo}/${primary.position}`,
    reasons,
  });
}

export async function reviewNextDutyRest(
  solver: SolverPort,
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): Promise<string[]> {
  const protection = facts?.nextDutyRest ?? nextDutyRestProtection(state, date);
  if (!protection.dutyStaffId) return [];
  const reviewed = new Set<string>();
  const warnings: string[] = [];
  const protectedAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .filter((assignment) => {
      const rule = assignmentRule(state, assignment);
      return Boolean(
        rule &&
        isNextDutyRestConflict(
          state,
          assignment.staffId!,
          rule,
          date,
          protection
        )
      );
    });

  for (const primary of protectedAssignments) {
    if (reviewed.has(primary.id)) continue;
    const attemptedReasons = (primary.decisionTrace ?? [])
      .filter(
        (decision) =>
          decision.ruleId === "next-duty-rest" &&
          decision.outcome === "fallback"
      )
      .map((decision) => decision.message)
      .filter(Boolean);
    const rule = assignmentRule(state, primary)!;
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
      review: "next-duty-rest",
      facts,
      primaryCandidateAllowed: (person) =>
        !isNextDutyRestConflict(state, person.id, rule, date, protection),
      maxParticipants: 3,
    });
    attemptedReasons.push(...result.attemptedReasons);
    if (result.changes) {
      applyRestPlan(
        state,
        assignments,
        primary,
        result.changes,
        protection.nextWorkdayDate
      );
      result.changes.forEach((change) => reviewed.add(change.assignmentId));
      continue;
    }
    reviewed.add(primary.id);
    const message = restFallback(
      primary,
      protection.nextWorkdayDate,
      attemptedReasons
    );
    replaceAssignmentDecisions(primary, "next-duty-rest", [
      schedulingDecision("next-duty-rest", "fallback", message),
    ]);
    warnings.push(message);
  }
  return warnings;
}
