import type { AppState, Assignment, PositionRule } from "../model";
import { durationHours } from "./time";

function assignmentRule(state: AppState, assignment: Assignment): PositionRule | undefined {
  return assignment.positionRuleId
    ? state.positionRules.find((rule) => rule.id === assignment.positionRuleId)
    : undefined;
}

export function isSupervisorMoveSlot(state: AppState, assignment: Assignment): boolean {
  const rule = assignmentRule(state, assignment);
  return Boolean(rule && (rule.category === "督导补位" || (rule.category === "常规" && rule.name.includes("督导"))));
}

function emptyStatus(state: AppState, assignment: Assignment): Assignment["status"] {
  const rule = assignmentRule(state, assignment);
  return !assignment.positionRuleId || rule?.manual || rule?.category === "督导补位" ? "manual" : "unfilled";
}

function isSupervisorFill(state: AppState, assignment: Assignment): boolean {
  return assignmentRule(state, assignment)?.category === "督导补位";
}

function regularSupervisorForFlight(state: AppState, flightId: string): Assignment | undefined {
  return state.assignments.find((assignment) => {
    const rule = assignmentRule(state, assignment);
    return assignment.flightId === flightId
      && assignment.status === "assigned"
      && Boolean(assignment.staffName)
      && rule?.category === "常规"
      && rule.name.includes("督导");
  });
}

function normalizeDetachedFillWorkload(state: AppState, assignment: Assignment): void {
  if (!isSupervisorFill(state, assignment)) return;
  const regularSupervisor = regularSupervisorForFlight(state, assignment.flightId);
  const duplicatesRegularSupervisor = Boolean(
    assignment.staffName
    && regularSupervisor?.staffName
    && (assignment.staffId
      ? assignment.staffId === regularSupervisor.staffId
      : assignment.staffName === regularSupervisor.staffName)
  );
  if (duplicatesRegularSupervisor) {
    assignment.workHours = 0;
    assignment.fatiguePoints = 0;
    return;
  }
  const flight = state.flights.find((item) => item.id === assignment.flightId);
  const rule = assignmentRule(state, assignment);
  if (flight) assignment.workHours = durationHours(flight.startTime, flight.endTime);
  assignment.fatiguePoints = rule?.fatiguePoints ?? assignment.workHours;
}

export function moveSupervisorWithinFlight(
  state: AppState,
  sourceAssignmentId: string,
  targetAssignmentId: string
): string | null {
  const source = state.assignments.find((assignment) => assignment.id === sourceAssignmentId);
  const target = state.assignments.find((assignment) => assignment.id === targetAssignmentId);
  if (!source || !target) return "源岗位或目标岗位不存在";
  if (source.flightId !== target.flightId) return "督导岗位只能在同一航班内移动";
  if (!isSupervisorMoveSlot(state, source) || !isSupervisorMoveSlot(state, target)) return "仅支持同一航班的督导岗位之间移动";
  if (!source.staffName) return "源督导岗位没有可移动人员";
  const sourcePerson = source.staffId ? state.staff.find((person) => person.id === source.staffId) : undefined;
  const targetPerson = target.staffId ? state.staff.find((person) => person.id === target.staffId) : undefined;
  if (sourcePerson && sourcePerson.status !== "正常") return `${sourcePerson.name} 当前状态为${sourcePerson.status}`;
  if (targetPerson && targetPerson.status !== "正常") return `${targetPerson.name} 当前状态为${targetPerson.status}`;

  const samePerson = Boolean(source.staffName && target.staffName && (source.staffId
    ? source.staffId === target.staffId
    : source.staffName === target.staffName));
  const targetStaff = samePerson
    ? { staffId: null, staffName: "", status: emptyStatus(state, source) }
    : { staffId: target.staffId, staffName: target.staffName, status: target.status };
  target.staffId = source.staffId;
  target.staffName = source.staffName;
  target.status = "assigned";
  delete target.systemNotes;

  source.staffId = targetStaff.staffId;
  source.staffName = targetStaff.staffName;
  source.status = targetStaff.staffName ? "assigned" : emptyStatus(state, source);
  delete source.systemNotes;
  if (isSupervisorFill(state, source)) source.supervisorFillDetached = true;
  if (isSupervisorFill(state, target)) target.supervisorFillDetached = true;
  normalizeDetachedFillWorkload(state, source);
  normalizeDetachedFillWorkload(state, target);
  return null;
}

export function applySupervisorFillToRegularPosition(
  state: AppState,
  sourceAssignmentId: string,
  targetAssignmentId: string
): string | null {
  const source = state.assignments.find((assignment) => assignment.id === sourceAssignmentId);
  const target = state.assignments.find((assignment) => assignment.id === targetAssignmentId);
  if (!source || !target || !source.staffId || !source.staffName) return "源岗位或目标岗位不存在";
  const sourceRule = assignmentRule(state, source);
  const targetRule = assignmentRule(state, target);
  const supervisor = state.assignments.find((assignment) => {
    const rule = assignmentRule(state, assignment);
    return assignment.id !== source.id
      && assignment.flightId === source.flightId
      && assignment.staffId === source.staffId
      && assignment.status === "assigned"
      && rule?.category === "常规"
      && rule.name.includes("督导");
  });
  if (sourceRule?.category !== "督导补位" || targetRule?.category !== "常规" || !supervisor) return "督导机动补位条件不成立";

  source.staffId = null;
  source.staffName = "";
  source.status = "manual";
  source.workHours = 0;
  source.fatiguePoints = 0;
  source.supervisorFillDetached = true;
  delete source.systemNotes;

  target.staffId = supervisor.staffId;
  target.staffName = supervisor.staffName;
  target.status = "assigned";
  target.workHours = 0;
  target.fatiguePoints = targetRule.fatiguePoints;
  target.supervisorCoverSourceAssignmentId = supervisor.id;
  delete target.systemNotes;
  return null;
}

export function resetSupervisorCoverAssignment(state: AppState, assignment: Assignment): void {
  if (!assignment.supervisorCoverSourceAssignmentId) return;
  delete assignment.supervisorCoverSourceAssignmentId;
  const flight = state.flights.find((item) => item.id === assignment.flightId);
  const rule = assignmentRule(state, assignment);
  if (flight) assignment.workHours = durationHours(flight.startTime, flight.endTime);
  assignment.fatiguePoints = rule?.fatiguePoints ?? assignment.workHours;
}

export function normalizeSupervisorCoverAssignments(state: AppState): void {
  state.assignments.forEach((assignment) => {
    if (!assignment.supervisorCoverSourceAssignmentId) return;
    const source = state.assignments.find((item) => item.id === assignment.supervisorCoverSourceAssignmentId);
    const rule = assignmentRule(state, assignment);
    const sourceRule = source ? assignmentRule(state, source) : undefined;
    const valid = Boolean(
      assignment.staffId
      && assignment.status === "assigned"
      && rule?.category === "常规"
      && source?.flightId === assignment.flightId
      && source.staffId === assignment.staffId
      && source.status === "assigned"
      && sourceRule?.category === "常规"
      && sourceRule.name.includes("督导")
    );
    if (!valid) {
      resetSupervisorCoverAssignment(state, assignment);
      return;
    }
    assignment.workHours = 0;
    assignment.fatiguePoints = rule?.fatiguePoints ?? 0;
  });
}

export function normalizeSupervisorFillAssignments(state: AppState): void {
  state.assignments.forEach((assignment) => {
    const rule = assignmentRule(state, assignment);
    if (rule?.category !== "督导补位") return;
    if (assignment.supervisorFillDetached === true) {
      if (!assignment.staffName) assignment.status = "manual";
      normalizeDetachedFillWorkload(state, assignment);
      return;
    }
    const supervisor = regularSupervisorForFlight(state, assignment.flightId);
    assignment.staffId = supervisor?.staffId ?? null;
    assignment.staffName = supervisor?.staffName ?? "";
    assignment.status = supervisor ? "assigned" : "manual";
    assignment.workHours = 0;
    assignment.fatiguePoints = 0;
    assignment.supervisorFillDetached = false;
    delete assignment.systemNotes;
  });
}
