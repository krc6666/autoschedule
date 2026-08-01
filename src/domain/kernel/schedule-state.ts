import type { AppState, Assignment, Staff, StaffStatus } from "../../model";

function linkedStaff(
  state: AppState,
  assignment: Assignment
): Staff | undefined {
  return assignment.staffId
    ? state.staff.find((person) => person.id === assignment.staffId)
    : assignment.staffName
      ? state.staff.find((person) => person.name === assignment.staffName)
      : undefined;
}

export function assignmentUsesUnavailableStaff(
  state: AppState,
  assignment: Assignment
): boolean {
  const person = linkedStaff(state, assignment);
  return Boolean(person && person.status !== "正常");
}

export function removeUnavailableStaffAssignments(state: AppState): void {
  state.assignments.forEach((assignment) => {
    if (!assignmentUsesUnavailableStaff(state, assignment)) return;
    const rule = assignment.positionRuleId
      ? state.positionRules.find(
          (item) => item.id === assignment.positionRuleId
        )
      : undefined;
    assignment.staffId = null;
    assignment.staffName = "";
    assignment.status =
      !assignment.positionRuleId ||
      rule?.manual ||
      rule?.category === "行政支援"
        ? "manual"
        : "unfilled";
    delete assignment.supervisorSourceAssignmentId;
    delete assignment.systemNotes;
  });
}

export function applyStaffStatusChange(
  state: AppState,
  staffId: string,
  status: StaffStatus
): boolean {
  const person = state.staff.find((item) => item.id === staffId);
  if (!person) return false;
  person.status = status;
  removeUnavailableStaffAssignments(state);
  return true;
}
