import type { AppState, Assignment, Staff } from "../../model";
import { analyzeAutomaticEligibilityPool } from "../candidates/assignment-eligibility";
import { violatedPositionTransitionPoliciesForInsertion } from "../reviews/schedule-protection";
import {
  mustAutoFillPreNoon,
  type AssignmentTask,
} from "../flights/schedule-tasks";

function alternativeStaffReason(
  state: AppState,
  assignments: Assignment[],
  selected: Staff,
  task: AssignmentTask
): string {
  const pool = analyzeAutomaticEligibilityPool({
    state,
    assignments,
    flight: task.flight,
    rule: task.rule,
    excludedStaffIds: new Set([selected.id]),
  });
  if (!pool.configured.length) return "唯一合格人员";
  if (!pool.available.length) return "其他具备资质人员均为休假、病假或请假状态";
  if (!pool.nightCapable.length) return "其他具备资质人员均不符合夜班能力要求";
  if (!pool.conflictFree.length) return "其他具备资质人员均存在时间冲突";
  if (!pool.withinHours.length) return "其他具备资质人员均会超过每日工时上限";
  return "岗位完整性或更高优先级锁定优先";
}

export function strictOverrideNotes(
  state: AppState,
  assignments: Assignment[],
  person: Staff,
  task: AssignmentTask
): string[] {
  if (!mustAutoFillPreNoon(task.flight, task.rule)) return [];
  const rules: string[] = [];
  rules.push(
    ...violatedPositionTransitionPoliciesForInsertion(
      assignments,
      person.id,
      task.flight.flightNo,
      task.rule.name,
      task.flight.startTime,
      task.flight.endTime,
      state,
      "forbid"
    ).map((policy) => policy.name)
  );
  return [...new Set(rules)].map((rule) => `已突破严格限制仍安排：${rule}`);
}

export function nextWorkdayRecoveryOverrideReason(
  state: AppState,
  assignments: Assignment[],
  selected: Staff,
  task: AssignmentTask,
  dutyStaffId: string | null,
  isDutyTarget: boolean,
  ke166Locked: boolean,
  protectedMorningTarget: boolean
): string {
  if (selected.id === dutyStaffId && isDutyTarget)
    return protectedMorningTarget
      ? "值班上午上岗要求优先"
      : "值班晚撤岗位锁定优先";
  if (ke166Locked) return "KE166机动督导锁定优先";
  return alternativeStaffReason(state, assignments, selected, task);
}

export function nextDutyRestOverrideReason(
  state: AppState,
  assignments: Assignment[],
  selected: Staff,
  task: AssignmentTask,
  dutyStaffId: string | null,
  isDutyTarget: boolean,
  ke166Locked: boolean
): string {
  if (selected.id === dutyStaffId && isDutyTarget)
    return "本班值班岗位锁定优先";
  if (ke166Locked) return "KE166机动督导锁定优先";
  return alternativeStaffReason(state, assignments, selected, task);
}
