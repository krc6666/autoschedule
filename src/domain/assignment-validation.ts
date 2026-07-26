import type { AppState } from "../model";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { applyEarlyReleases, canReleaseForFlight, projectedAssignedHours } from "./assignment-timing";
import { assignmentRule, isReusableAssignment } from "./schedule-position-rules";
import { positionTransitionCost } from "./schedule-protection";
import { intervalsOverlap, isNightInterval } from "./time";

export function canAssignStaff(
  state: AppState,
  assignmentId: string,
  staffId: string,
  ignoreAssignmentId?: string
): string | null {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const person = state.staff.find((item) => item.id === staffId);
  if (!assignment || !person) return "人员或岗位不存在";
  if (person.status !== "正常") return `${person.name} 当前状态为${person.status}`;
  const rule = assignmentRule(state, assignment);
  const administrativeStaff = person.staffType === "行政支援";
  if (administrativeStaff && !state.settings.adminSupportEnabled) return "行政支援模式尚未启用";
  if (administrativeStaff && (!rule || !rule.qualifiedStaffIds.includes(person.id))) return `${person.name} 不具备该岗位资质`;
  if (rule && rule.category !== "引导" && !rule.manual && !rule.qualifiedStaffIds.includes(person.id)) {
    return `${person.name} 不具备该岗位资质`;
  }
  if (administrativeStaff && rule) {
    const flight = state.flights.find((item) => item.id === assignment.flightId);
    const otherAssignments = state.assignments.filter((item) => item.id !== assignmentId);
    const regularAvailable = flight && eligibleStaffForRule(state, flight, rule).some((regular) => {
      const conflicts = otherAssignments.filter((item) => item.staffId === regular.id)
        .filter((item) => item.flightId !== assignment.flightId || !isReusableAssignment(state, item));
      return conflicts.every((item) => !intervalsOverlap(
        item.startTime,
        item.endTime,
        flight.startTime,
        flight.endTime
      ) || canReleaseForFlight(item, flight, state))
        && projectedAssignedHours(otherAssignments, regular.id, flight, state) + assignment.workHours <= state.settings.maxDailyHours
        && positionTransitionCost(
          otherAssignments,
          regular.id,
          assignment.flightNo,
          assignment.position,
          assignment.startTime,
          state,
          "forbid"
        ) === 0;
    });
    if (regularAvailable) return "仍有满足硬约束的常规人员可用，应优先安排常规人员";
  }
  if (isNightInterval(
    assignment.startTime,
    assignment.endTime,
    state.settings.nightStart,
    state.settings.nightEnd
  ) && !person.nightShift) return `${person.name} 不可上夜班`;
  const reuse = rule?.category === "引导";
  const others = state.assignments.filter((item) => item.id !== assignmentId
    && (reuse || item.id !== ignoreAssignmentId)
    && item.staffId === staffId);
  if (reuse) {
    if (person.staffType !== "常规") return "引导岗位只能复用常规人员";
    const source = others.find((item) => item.flightId === assignment.flightId
      && item.status === "assigned"
      && assignmentRule(state, item)?.category === "常规");
    if (!source) return `${person.name} 未在该航班承担常规岗位`;
  }
  const conflicts = reuse
    ? others.filter((item) => item.flightId !== assignment.flightId)
    : others.filter((item) => item.flightId !== assignment.flightId || !isReusableAssignment(state, item));
  if (conflicts.some((item) => intervalsOverlap(
    item.startTime,
    item.endTime,
    assignment.startTime,
    assignment.endTime
  ) && !canReleaseForFlight(item, assignment, state))) return `${person.name} 在该时段已有排班`;
  if (projectedAssignedHours(others, staffId, assignment, state) + assignment.workHours > state.settings.maxDailyHours) {
    return `${person.name} 将超过每日 ${state.settings.maxDailyHours} 小时上限`;
  }
  if (positionTransitionCost(
    others,
    staffId,
    assignment.flightNo,
    assignment.position,
    assignment.startTime,
    state,
    "forbid"
  ) > 0) return `${person.name} 不满足该岗位的最小衔接间隔`;
  return null;
}

export function applyEarlyReleaseForStaff(state: AppState, assignmentId: string, staffId: string): void {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  const others = state.assignments.filter((item) => item.id !== assignmentId);
  applyEarlyReleases(others, staffId, assignment, state);
}

export function isDiversionTransfer(state: AppState, sourceAssignmentId: string, targetAssignmentId: string): boolean {
  const source = state.assignments.find((item) => item.id === sourceAssignmentId);
  const target = state.assignments.find((item) => item.id === targetAssignmentId);
  return Boolean(source && target && canReleaseForFlight(source, target, state));
}
