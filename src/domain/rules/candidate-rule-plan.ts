import {
  compileSchedulingPlan,
  type CompiledCandidateRule,
} from "./scheduling-execution-plan";
import type { CandidatePriority } from "../candidates/candidate-priority";
import type { AssignmentTask } from "../flights/schedule-tasks";
import type { ScheduleSettings, Staff } from "../../model";

export type CandidateRulePlanItem = CompiledCandidateRule;

export function createCandidateRulePlan(
  settings: ScheduleSettings
): CandidateRulePlanItem[] {
  return [...compileSchedulingPlan(settings).candidateRules];
}

interface CandidatePair {
  task: AssignmentTask;
  left: Staff;
  leftPriority: CandidatePriority;
  right: Staff;
  rightPriority: CandidatePriority;
}

export function compareCandidateRulePlan(
  plan: readonly CandidateRulePlanItem[],
  task: AssignmentTask,
  left: Staff,
  leftPriority: CandidatePriority,
  right: Staff,
  rightPriority: CandidatePriority
): number {
  const pair: CandidatePair = {
    task,
    left,
    leftPriority,
    right,
    rightPriority,
  };
  for (const rule of plan) {
    const difference = rule.execute(pair);
    if (difference) return difference;
  }
  return 0;
}

export function firstDifferentCandidateRulePlan(
  plan: readonly CandidateRulePlanItem[],
  task: AssignmentTask,
  left: Staff,
  leftPriority: CandidatePriority,
  right: Staff,
  rightPriority: CandidatePriority
): CandidateRulePlanItem | null {
  const pair: CandidatePair = {
    task,
    left,
    leftPriority,
    right,
    rightPriority,
  };
  return plan.find((rule) => rule.execute(pair) !== 0) ?? null;
}
