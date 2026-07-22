import type { AppState, Assignment, ScheduleResult, Staff, StaffStatus } from "../model";
import { generateSchedule } from "./scheduler";

function linkedStaff(state: AppState, assignment: Assignment): Staff | undefined {
  return assignment.staffId
    ? state.staff.find((person) => person.id === assignment.staffId)
    : assignment.staffName
      ? state.staff.find((person) => person.name === assignment.staffName)
      : undefined;
}

export function assignmentUsesUnavailableStaff(state: AppState, assignment: Assignment): boolean {
  const person = linkedStaff(state, assignment);
  return Boolean(person && person.status !== "正常");
}

export function removeUnavailableStaffAssignments(state: AppState): void {
  state.assignments.forEach((assignment) => {
    if (!assignmentUsesUnavailableStaff(state, assignment)) return;
    const rule = assignment.positionRuleId
      ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
      : undefined;
    assignment.staffId = null;
    assignment.staffName = "";
    assignment.status = !assignment.positionRuleId || rule?.manual || rule?.category === "行政支援" || rule?.category === "督导补位" ? "manual" : "unfilled";
    delete assignment.systemNotes;
  });
}

export function applyStaffStatusChange(
  state: AppState,
  staffId: string,
  status: StaffStatus
): ScheduleResult | null {
  const person = state.staff.find((item) => item.id === staffId);
  if (!person) return null;
  person.status = status;
  if (!state.activeScheduleDate) {
    removeUnavailableStaffAssignments(state);
    return null;
  }
  const result = generateSchedule(state, state.activeScheduleDate);
  state.assignments = result.assignments;
  return result;
}
