import type { Assignment } from "../../model";
import type { AssignmentEligibilityFacts } from "../shared/scheduling-facts";
import { evaluateSupervisorFillFacts } from "../coverage/supervisor-fill-facts";
import { clearAutomaticAssignmentEvidence } from "./assignment-evidence";
import { schedulingDecision } from "../rules/schedule-rule-contract";

export function fillConfiguredSupervisorTargets(
  state: AssignmentEligibilityFacts,
  assignments: Assignment[],
  source: Assignment,
  mode: "automatic" | "manual"
): Assignment[] {
  const filled: Assignment[] = [];
  for (const target of assignments) {
    if (
      target.id === source.id ||
      target.status === "assigned" ||
      target.staffId
    )
      continue;
    const evaluation = evaluateSupervisorFillFacts(
      state,
      assignments,
      source,
      target,
      mode
    );
    if (!evaluation.allowed) continue;
    target.staffId = source.staffId;
    target.staffName = source.staffName;
    target.status = "assigned";
    target.workHours = 0;
    target.fatiguePoints = 0;
    target.supervisorSourceAssignmentId = source.id;
    target.supervisorFillRuleId = evaluation.rule?.id;
    clearAutomaticAssignmentEvidence(target);
    target.decisionTrace = [
      ...(target.decisionTrace ?? []),
      schedulingDecision(
        "mobile-supervisor",
        "selected",
        `${source.staffName}在人手不足时由${source.flightNo}/${source.position}补位${target.flightNo}/${target.position}`
      ),
    ];
    filled.push(target);
  }
  return filled;
}
