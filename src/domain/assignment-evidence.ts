import type { Assignment } from "../model";
import type {
  SchedulingDecision,
  SchedulingRuleId,
} from "../schedule-rule-contract";

export function clearAutomaticAssignmentEvidence(assignment: Assignment): void {
  delete assignment.systemNotes;
  delete assignment.decisionTrace;
}

export function replaceAssignmentDecisions(
  assignment: Assignment,
  ruleId: SchedulingRuleId,
  decisions: readonly SchedulingDecision[]
): void {
  const remaining =
    assignment.decisionTrace?.filter(
      (decision) => decision.ruleId !== ruleId
    ) ?? [];
  const next = [...remaining, ...decisions];
  if (next.length) assignment.decisionTrace = next;
  else delete assignment.decisionTrace;
}

export function appendAssignmentDecision(
  assignment: Assignment,
  decision: SchedulingDecision
): void {
  assignment.decisionTrace = [...(assignment.decisionTrace ?? []), decision];
}

export function rebuildAutomaticAssignmentEvidence(
  assignment: Assignment,
  decisions: readonly SchedulingDecision[]
): void {
  clearAutomaticAssignmentEvidence(assignment);
  if (decisions.length) assignment.decisionTrace = [...decisions];
}

export interface AssignmentDecisionQuery {
  ruleIds?: ReadonlySet<SchedulingRuleId>;
  outcomes?: ReadonlySet<SchedulingDecision["outcome"]>;
}

export function assignmentDecisions(
  assignments: readonly Assignment[],
  query: AssignmentDecisionQuery = {}
): SchedulingDecision[] {
  return assignments
    .flatMap((assignment) => assignment.decisionTrace ?? [])
    .filter(
      (decision) =>
        (!query.ruleIds || query.ruleIds.has(decision.ruleId)) &&
        (!query.outcomes || query.outcomes.has(decision.outcome))
    );
}

export function assignmentDecisionMessages(
  assignments: readonly Assignment[],
  query: AssignmentDecisionQuery = {}
): string[] {
  return [
    ...new Set(
      assignmentDecisions(assignments, query).map(
        (decision) => decision.message
      )
    ),
  ];
}
