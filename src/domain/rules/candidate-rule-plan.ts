import type { ScheduleSettings, Staff } from "../../model";
import type {
  SchedulingRuleId,
  SchedulingRuleStage,
} from "./schedule-rule-contract";
import {
  BUILT_IN_RULE_REGISTRY,
  builtInRulePreferences,
} from "./built-in-rule-registry";
import type { CandidatePriority } from "../candidates/candidate-priority";
import type { CandidatePriorityExecutor } from "./rule-registry";
import type { AssignmentTask } from "../flights/schedule-tasks";

export interface CandidateRulePlanItem {
  id: SchedulingRuleId;
  label: string;
  stage: SchedulingRuleStage;
  source: "built-in";
  execute: CandidatePriorityExecutor["execute"];
}

export function createCandidateRulePlan(
  settings: ScheduleSettings
): CandidateRulePlanItem[] {
  return BUILT_IN_RULE_REGISTRY.executionPlan(
    builtInRulePreferences(settings)
  ).flatMap((hook) => {
    if (!hook.enabled) return [];
    return hook.execute.flatMap<CandidateRulePlanItem>((executor) =>
      executor.kind === "candidate-priority"
        ? [
            {
              id: hook.id as SchedulingRuleId,
              label: hook.label,
              stage: hook.stage,
              source: hook.source,
              execute: executor.execute,
            },
          ]
        : []
    );
  });
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
