import type { Assignment } from "../../model";
import type { WorkloadAccountingFacts } from "./scheduling-facts";

export function isCountedWorkloadAssignment(
  state: WorkloadAccountingFacts,
  assignment: Assignment
): boolean {
  const person = assignment.staffId
    ? state.staff.find((item) => item.id === assignment.staffId)
    : undefined;
  if (person?.staffType === "行政支援") return false;
  const rule = assignment.positionRuleId
    ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
    : undefined;
  return rule?.category !== "行政支援" && rule?.category !== "引导";
}

export function countedWorkloadAssignments(
  state: WorkloadAccountingFacts,
  assignments = state.assignments
): Assignment[] {
  return assignments.filter((assignment) =>
    isCountedWorkloadAssignment(state, assignment)
  );
}
