import {
  activeFlightRules,
  applyEarlyReleaseForStaff,
  canAssignStaff,
  isAuxiliaryCategory,
  isDiversionTransfer,
  isGuideAssignment
} from "../domain/scheduler";
import { clearSupervisorLink, moveSupervisorWithinFlight, normalizeSupervisorAssignments } from "../domain/schedule-adjustment";
import type { AppState, Staff } from "../model";
import { createId, normalizeText } from "../utils";

export interface ScheduleEditResult {
  changed: boolean;
  message?: string;
  error?: string;
}

export function createTemporaryAssignment(
  state: AppState,
  flightId: string,
  position: string,
  staffName: string,
  layoutGroup: "primary" | "bottom",
  layoutIndex: number
): boolean {
  const flight = state.flights.find((item) => item.id === flightId);
  if (!flight) return false;
  state.assignments.push({
    id: createId("assignment"), flightId: flight.id, flightNo: flight.flightNo, positionRuleId: null,
    position: normalizeText(position) || "临时岗位", staffId: null, staffName: normalizeText(staffName),
    startTime: flight.startTime, endTime: flight.endTime, workHours: 0, fatiguePoints: 0, remark: "", manualRemark: "",
    status: normalizeText(staffName) ? "assigned" : "manual", layoutGroup, layoutIndex
  });
  return true;
}

function refreshSameFlightGuides(state: AppState, flightIds: string[]): void {
  normalizeSupervisorAssignments(state);
  for (const flightId of new Set(flightIds)) {
    const guideAssignments = state.assignments.filter((item) => item.flightId === flightId && isGuideAssignment(state, item));
    const flight = state.flights.find((item) => item.id === flightId);
    const displayIndex = new Map((flight ? activeFlightRules(state, flight) : []).map((rule, index) => [rule.id, index]));
    const usedStaffIds = new Set<string>();
    for (const guide of guideAssignments) {
      const candidates = state.assignments
        .filter((item) => item.flightId === flightId && item.id !== guide.id && item.status === "assigned")
        .filter((item) => item.staffId && !usedStaffIds.has(item.staffId))
        .map((item) => ({
          assignment: item,
          sourceRule: item.positionRuleId ? state.positionRules.find((rule) => rule.id === item.positionRuleId) : undefined,
          person: state.staff.find((person) => person.id === item.staffId)
        }))
        .filter((item): item is typeof item & { person: Staff } => Boolean(item.sourceRule?.category === "常规" && item.person?.status === "正常" && item.person.staffType === "常规"))
        .sort((left, right) => (displayIndex.get(right.assignment.positionRuleId ?? "") ?? -1) - (displayIndex.get(left.assignment.positionRuleId ?? "") ?? -1));
      const selected = candidates[0]?.person;
      guide.staffId = selected?.id ?? null;
      guide.staffName = selected?.name ?? "";
      guide.status = selected ? "assigned" : "unfilled";
      if (selected) usedStaffIds.add(selected.id);
    }
  }
}

export function assignStaff(
  state: AppState,
  assignmentId: string,
  staffId: string,
  sourceAssignmentId?: string
): ScheduleEditResult {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment || sourceAssignmentId === assignmentId) return { changed: false };
  if (!staffId) {
    const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
    clearSupervisorLink(state, assignment);
    assignment.staffId = null;
    assignment.staffName = "";
    assignment.status = rule?.manual || isAuxiliaryCategory(rule?.category) || !assignment.positionRuleId ? "manual" : "unfilled";
    delete assignment.systemNotes;
    refreshSameFlightGuides(state, [assignment.flightId]);
    return { changed: true, message: "岗位已设为待补位" };
  }
  const source = sourceAssignmentId ? state.assignments.find((item) => item.id === sourceAssignmentId) : undefined;
  if (source) {
    const error = moveSupervisorWithinFlight(state, source.id, assignment.id);
    if (!error) {
      refreshSameFlightGuides(state, [assignment.flightId]);
      return { changed: true, message: "督导已机动补位至目标岗位" };
    }
    const sourceRule = source.positionRuleId ? state.positionRules.find((item) => item.id === source.positionRuleId) : undefined;
    if (sourceRule?.category === "机动督导" || source.supervisorSourceAssignmentId) return { changed: false, error };
  }
  const targetStaffId = assignment.staffId;
  const targetStaffName = assignment.staffName;
  const copySource = Boolean(sourceAssignmentId && (isGuideAssignment(state, assignment)
    || (!targetStaffId && isDiversionTransfer(state, sourceAssignmentId, assignmentId))));
  const error = canAssignStaff(state, assignmentId, staffId, copySource ? undefined : sourceAssignmentId);
  if (error) return { changed: false, error };
  const person = state.staff.find((item) => item.id === staffId);
  if (!person) return { changed: false };
  if (source && !copySource && targetStaffId) {
    const reverseError = canAssignStaff(state, source.id, targetStaffId, assignment.id);
    if (reverseError) return { changed: false, error: `无法交换：${reverseError}` };
  }
  clearSupervisorLink(state, assignment);
  assignment.staffId = person.id;
  assignment.staffName = person.name;
  assignment.status = "assigned";
  delete assignment.systemNotes;
  if (source && !copySource) {
    clearSupervisorLink(state, source);
    if (targetStaffId) {
      source.staffId = targetStaffId;
      source.staffName = targetStaffName;
      source.status = "assigned";
      delete source.systemNotes;
    } else {
      const sourceRule = source.positionRuleId ? state.positionRules.find((item) => item.id === source.positionRuleId) : undefined;
      source.staffId = null;
      source.staffName = "";
      source.status = sourceRule?.manual || isAuxiliaryCategory(sourceRule?.category) || !source.positionRuleId ? "manual" : "unfilled";
      delete source.systemNotes;
    }
  }
  applyEarlyReleaseForStaff(state, assignment.id, person.id);
  if (source && targetStaffId && !copySource) applyEarlyReleaseForStaff(state, source.id, targetStaffId);
  refreshSameFlightGuides(state, [assignment.flightId, ...(source ? [source.flightId] : [])]);
  return {
    changed: true,
    message: source && targetStaffId && !copySource
      ? "人员岗位已交换"
      : copySource
        ? isGuideAssignment(state, assignment) ? "引导人员已复用" : "分流人员已转派"
        : "人员分配已更新"
  };
}

export function updateAssignmentField(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): ScheduleEditResult {
  const assignment = state.assignments.find((item) => item.id === id);
  if (!assignment) return { changed: false };
  if (field === "manualRemark") {
    assignment.manualRemark = normalizeText(value);
    return { changed: true };
  }
  if (field === "position" && !assignment.positionRuleId) {
    assignment.position = normalizeText(value) || "临时岗位";
    return { changed: true };
  }
  if (field !== "staffName") return { changed: false };

  const staffName = normalizeText(value);
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  if (!staffName) return assignStaff(state, id, "");
  const person = state.staff.find((item) => item.name === staffName);
  if (!person && rule?.category === "引导") {
    return {
      changed: false,
      error: "引导岗位只能复用同一航班中已排常规岗位的常规人员"
    };
  }
  if (!person || (person.staffType !== "行政支援" && (isAuxiliaryCategory(rule?.category) || !assignment.positionRuleId))) {
    clearSupervisorLink(state, assignment);
    assignment.staffId = null;
    assignment.staffName = staffName;
    assignment.status = "assigned";
    delete assignment.systemNotes;
    return { changed: true };
  }
  return assignStaff(state, id, person.id);
}

export function deleteTemporaryAssignment(state: AppState, id: string): boolean {
  const assignment = state.assignments.find((item) => item.id === id);
  if (!assignment || assignment.positionRuleId) return false;
  state.assignments = state.assignments.filter((item) => item.id !== id);
  return true;
}
