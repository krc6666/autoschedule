import type { AppState, Assignment } from "../model";
import { canAssignStaff } from "./assignment-validation";
import {
  comparePositionFrequency,
  consecutivePositionAssignments,
  positionFrequencyProfileForAssignment
} from "./schedule-frequency";
import { assignmentRule } from "./schedule-position-rules";
import {
  hasHighLoadTransition,
  lateShiftRecoveryRisk,
  positionTransitionInsertionCost,
  rollingLoadCost
} from "./schedule-protection";
import { isPriorityRotationPosition } from "./scheduling-policy";
import { intervalsOverlap } from "./time";

export function isRotationLocked(
  state: AppState,
  assignment: Assignment,
  lockedAssignmentIds: ReadonlySet<string>
): boolean {
  const rule = assignmentRule(state, assignment);
  return lockedAssignmentIds.has(assignment.id)
    || assignment.status !== "assigned"
    || !assignment.staffId
    || !assignment.positionRuleId
    || assignment.supervisorSourceAssignmentId !== undefined
    || !rule
    || rule.category !== "常规"
    || rule.manual;
}

export function rotationCandidateAssignments(
  assignments: Assignment[],
  primary: Assignment,
  state: AppState,
  lockedAssignmentIds: ReadonlySet<string>
): Assignment[] {
  const available = assignments.filter((assignment) => assignment.id !== primary.id
    && !isRotationLocked(state, assignment, lockedAssignmentIds));
  const sameFlight = available.filter((assignment) => assignment.flightId === primary.flightId);
  const overlappingFlights = available.filter((assignment) => assignment.flightId !== primary.flightId
    && intervalsOverlap(assignment.startTime, assignment.endTime, primary.startTime, primary.endTime));
  return [...sameFlight, ...overlappingFlights];
}

export function rotationCycleReason(reason: string): string {
  if (reason.includes("夜班")) return "候选人不具备夜班能力";
  if (reason.includes("不具备")) return "没有具备双向岗位资质的人员";
  if (reason.includes("已有排班")) return "交换后会产生时间冲突";
  if (reason.includes("超过每日")) return "交换后超过每日工时上限";
  if (reason.includes("衔接")) return "交换后违反严格岗位衔接保护";
  return reason;
}

export function rotationCycleSafetyReasons(
  state: AppState,
  assignments: Assignment[],
  cycle: Assignment[],
  date: string,
  review: "consecutive" | "frequency"
): string[] {
  const originalById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const planned = assignments.map((assignment) => {
    const index = cycle.findIndex((item) => item.id === assignment.id);
    if (index < 0) return assignment;
    const incoming = cycle[(index + 1) % cycle.length]!;
    const person = incoming.staffId ? state.staff.find((item) => item.id === incoming.staffId) : undefined;
    return { ...assignment, staffId: incoming.staffId, staffName: person?.name ?? incoming.staffName };
  });
  const plannedState: AppState = { ...state, assignments: planned };
  const reasons: string[] = [];
  for (const assignment of planned.filter((item) => cycle.some((member) => member.id === item.id))) {
    if (!assignment.staffId) {
      reasons.push("交换后会造成其他岗位空缺");
      continue;
    }
    const conflicts = planned.filter((other) => other.id !== assignment.id
      && other.staffId === assignment.staffId
      && intervalsOverlap(other.startTime, other.endTime, assignment.startTime, assignment.endTime));
    if (conflicts.length) reasons.push("交换后会产生时间冲突");
    const assignmentError = canAssignStaff(plannedState, assignment.id, assignment.staffId);
    if (assignmentError) reasons.push(rotationCycleReason(assignmentError));
    const flight = state.flights.find((item) => item.id === assignment.flightId);
    if (!flight) {
      reasons.push("交换目标航班不存在");
      continue;
    }
    if (positionTransitionInsertionCost(planned, assignment.staffId, {
      key: `${flight.id}:${assignment.positionRuleId ?? assignment.id}`,
      flight,
      rule: assignmentRule(state, assignment)!
    }, state, "prefer") > 0) reasons.push("交换后违反岗位衔接保护");
    if (state.settings.highLoadProtectionEnabled
      && hasHighLoadTransition(planned, assignment.staffId, assignment.startTime, assignment.endTime, assignment.fatiguePoints, assignment.remark, state)) {
      reasons.push("交换后违反高负荷疲劳保护");
    }
    if (state.settings.rollingLoadProtectionEnabled
      && rollingLoadCost(planned, assignment.staffId, assignment.startTime, assignment.fatiguePoints, assignment.remark, state) > 0) {
      reasons.push("交换后违反滚动负荷保护");
    }
    if (lateShiftRecoveryRisk(state, assignment.staffId, {
      ...flight,
      position: assignment.position,
      remark: assignment.remark,
      fatiguePoints: assignment.fatiguePoints
    }, date).excess > 0) {
      reasons.push("交换后违反跨工作日晚班疲劳保护");
    }

    const original = originalById.get(assignment.id)!;
    if (review === "consecutive") {
      const before = original.staffId
        ? consecutivePositionAssignments(state, original.staffId, original.flightNo, original.position, date)
        : 0;
      const after = consecutivePositionAssignments(state, assignment.staffId, assignment.flightNo, assignment.position, date);
      if (assignment.id === cycle[0]!.id ? after >= before : after > before) {
        reasons.push("交换会把连续轮岗问题转移给其他人员");
      }
      const rule = assignmentRule(state, assignment);
      if (rule && isPriorityRotationPosition(rule) && original.staffId) {
        const frequencyBefore = positionFrequencyProfileForAssignment(state, original, original.staffId, date);
        const frequencyAfter = positionFrequencyProfileForAssignment(state, assignment, assignment.staffId, date);
        if (comparePositionFrequency(frequencyAfter, frequencyBefore) > 0) {
          reasons.push("交换会破坏重点岗位频率均衡");
        }
      }
    } else {
      const before = original.staffId
        ? positionFrequencyProfileForAssignment(state, original, original.staffId, date)
        : { currentMonthCount: 0, recentWorkdayCount: 0 };
      const after = positionFrequencyProfileForAssignment(state, assignment, assignment.staffId, date);
      const frequencyDifference = comparePositionFrequency(after, before);
      if (assignment.id === cycle[0]!.id ? frequencyDifference >= 0 : frequencyDifference > 0) {
        reasons.push("交换未降低目标岗位同岗频率或会转移高频问题");
      }
    }
  }
  const originalAssigned = assignments.filter((assignment) => assignment.status === "assigned" && assignment.staffId).length;
  const plannedAssigned = planned.filter((assignment) => assignment.status === "assigned" && assignment.staffId).length;
  if (originalAssigned !== plannedAssigned) reasons.push("交换后会造成其他岗位空缺");
  return [...new Set(reasons)];
}



