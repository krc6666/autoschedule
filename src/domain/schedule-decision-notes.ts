import type { AppState, Assignment, Staff } from "../model";
import { canReleaseForFlight, projectedAssignedHours, staffConflicts } from "./assignment-timing";
import { violatedPositionTransitionPoliciesForInsertion } from "./schedule-protection";
import { mustAutoFillPreNoon, type AssignmentTask } from "./schedule-tasks";
import { durationHours, isNightInterval } from "./time";

export function strictOverrideNotes(
  state: AppState,
  assignments: Assignment[],
  person: Staff,
  task: AssignmentTask
): string[] {
  if (!mustAutoFillPreNoon(task.flight, task.rule)) return [];
  const rules: string[] = [];
  rules.push(...violatedPositionTransitionPoliciesForInsertion(
    assignments,
    person.id,
    task.flight.flightNo,
    task.rule.name,
    task.flight.startTime,
    task.flight.endTime,
    state,
    "forbid"
  ).map((policy) => policy.name));
  return [...new Set(rules)].map((rule) => `已突破严格限制仍安排：${rule}`);
}

export function nextWorkdayRecoveryOverrideReason(
  state: AppState,
  assignments: Assignment[],
  selected: Staff,
  task: AssignmentTask,
  dutyStaffId: string | null,
  isDutyTarget: boolean,
  ke166Locked: boolean
): string {
  if (selected.id === dutyStaffId && isDutyTarget) return "值班早班锁定优先";
  if (ke166Locked) return "KE166机动督导锁定优先";
  const configuredOthers = state.staff.filter((person) => person.id !== selected.id
    && person.staffType === "常规"
    && task.rule.qualifiedStaffIds.includes(person.id));
  if (!configuredOthers.length) return "唯一合格人员";
  const normal = configuredOthers.filter((person) => person.status === "正常");
  if (!normal.length) return "其他具备资质人员均为休假、病假或请假状态";
  const nightCapable = normal.filter((person) => !isNightInterval(
    task.flight.startTime,
    task.flight.endTime,
    state.settings.nightStart,
    state.settings.nightEnd
  ) || person.nightShift);
  if (!nightCapable.length) return "其他具备资质人员均不符合夜班能力要求";
  const withoutConflict = nightCapable.filter((person) => staffConflicts(assignments, person.id, task.flight)
    .every((assignment) => canReleaseForFlight(assignment, task.flight, state)));
  if (!withoutConflict.length) return "其他具备资质人员均存在时间冲突";
  const hours = durationHours(task.flight.startTime, task.flight.endTime);
  const withinHours = withoutConflict.filter((person) => projectedAssignedHours(assignments, person.id, task.flight, state) + hours <= state.settings.maxDailyHours);
  if (!withinHours.length) return "其他具备资质人员均会超过每日工时上限";
  return "岗位完整性或更高优先级锁定优先";
}


