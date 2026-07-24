import type { AppState, Assignment, PositionRule } from "../model";
import { durationHours } from "./time";
import { evaluateMobileSupervisorCoverage } from "./mobile-supervisor-coverage";

function assignmentRule(state: AppState, assignment: Assignment): PositionRule | undefined {
  return assignment.positionRuleId
    ? state.positionRules.find((rule) => rule.id === assignment.positionRuleId)
    : undefined;
}

function emptyStatus(state: AppState, assignment: Assignment): Assignment["status"] {
  const rule = assignmentRule(state, assignment);
  return !assignment.positionRuleId || rule?.manual || rule?.category === "行政支援" ? "manual" : "unfilled";
}

export function isSupervisorAssignment(state: AppState, assignment: Assignment): boolean {
  return assignmentRule(state, assignment)?.category === "机动督导";
}

function supervisorSource(state: AppState, assignment: Assignment): Assignment | undefined {
  if (isSupervisorAssignment(state, assignment)) return assignment;
  return assignment.supervisorSourceAssignmentId
    ? state.assignments.find((item) => item.id === assignment.supervisorSourceAssignmentId)
    : undefined;
}

function resetSupervisorLinkedAssignment(state: AppState, assignment: Assignment): void {
  if (!assignment.supervisorSourceAssignmentId) return;
  delete assignment.supervisorSourceAssignmentId;
  const flight = state.flights.find((item) => item.id === assignment.flightId);
  const rule = assignmentRule(state, assignment);
  assignment.staffId = null;
  assignment.staffName = "";
  assignment.status = emptyStatus(state, assignment);
  assignment.workHours = flight ? durationHours(flight.startTime, flight.endTime) : assignment.workHours;
  assignment.fatiguePoints = rule?.fatiguePoints ?? assignment.workHours;
  delete assignment.systemNotes;
}

export function moveSupervisorWithinFlight(
  state: AppState,
  sourceAssignmentId: string,
  targetAssignmentId: string
): string | null {
  const source = state.assignments.find((assignment) => assignment.id === sourceAssignmentId);
  const target = state.assignments.find((assignment) => assignment.id === targetAssignmentId);
  if (!source || !target) return "源岗位或目标岗位不存在";
  const supervisor = supervisorSource(state, source);
  if (!supervisor || !isSupervisorAssignment(state, supervisor)) return "仅督导可在同一航班内机动补位";
  if (supervisor.flightId !== target.flightId) return "督导只能在同一航班内机动补位";
  if (isSupervisorAssignment(state, target)) return "航班顶部督导岗位固定，不能作为补位目标";
  if (!supervisor.staffId || !supervisor.staffName || supervisor.status !== "assigned") return "顶部督导尚未安排人员";
  if (target.staffId || target.staffName) return `目标岗位已有人员，请先清空 ${target.position}`;
  const coverage = evaluateMobileSupervisorCoverage(state, {
    flightNo: target.flightNo,
    position: target.position,
    remark: target.remark
  });
  if (!coverage.allowed) return `机动督导不能兼任 ${target.flightNo}/${target.position}：${coverage.reason}`;
  const person = state.staff.find((item) => item.id === supervisor.staffId);
  if (!person) return "督导人员不存在";
  if (person.status !== "正常") return `${person.name} 当前状态为${person.status}`;

  if (source.id !== supervisor.id) resetSupervisorLinkedAssignment(state, source);
  const targetRule = assignmentRule(state, target);
  target.staffId = supervisor.staffId;
  target.staffName = supervisor.staffName;
  target.status = "assigned";
  target.workHours = 0;
  target.fatiguePoints = targetRule?.fatiguePoints ?? 0;
  target.supervisorSourceAssignmentId = supervisor.id;
  delete target.systemNotes;
  return null;
}

export function clearSupervisorLink(state: AppState, assignment: Assignment): void {
  resetSupervisorLinkedAssignment(state, assignment);
}

export function normalizeSupervisorAssignments(state: AppState): void {
  state.assignments.forEach((assignment) => {
    if (!assignment.supervisorSourceAssignmentId) return;
    const source = state.assignments.find((item) => item.id === assignment.supervisorSourceAssignmentId);
    const valid = Boolean(
      source
      && isSupervisorAssignment(state, source)
      && source.flightId === assignment.flightId
      && source.staffId
      && source.staffName
      && source.status === "assigned"
      && evaluateMobileSupervisorCoverage(state, {
        flightNo: assignment.flightNo,
        position: assignment.position,
        remark: assignment.remark
      }).allowed
    );
    if (!valid || !source) {
      resetSupervisorLinkedAssignment(state, assignment);
      return;
    }
    const rule = assignmentRule(state, assignment);
    assignment.staffId = source.staffId;
    assignment.staffName = source.staffName;
    assignment.status = "assigned";
    assignment.workHours = 0;
    assignment.fatiguePoints = rule?.fatiguePoints ?? 0;
    delete assignment.systemNotes;
  });
}
