import type {
  PluginCandidatePreference,
  PluginManifest,
} from "../../infrastructure/plugin-protocol";
import type { ScheduleSettings, Staff } from "../../model";
import type {
  PluginSchedulingRuleId,
  SchedulingRuleId,
  SchedulingRuleStage,
} from "./schedule-rule-contract";
import {
  BUILT_IN_SCHEDULING_HOOKS,
  builtInRulePreferences,
} from "./built-in-rule-registry";
import type { CandidatePriority } from "../candidates/candidate-priority";
import {
  createRuleRegistry,
  type CandidateComparisonContext,
  type CandidatePriorityExecutor,
  type RulePreference,
  type SchedulingHook,
} from "./rule-registry";
import type { AssignmentTask } from "../flights/schedule-tasks";

export interface CandidateRulePlanItem {
  id: SchedulingRuleId | PluginSchedulingRuleId;
  label: string;
  stage: SchedulingRuleStage;
  source: "built-in" | `plugin:${string}`;
  execute: CandidatePriorityExecutor["execute"];
}

function pluginRuleId(
  plugin: PluginManifest,
  rule: PluginCandidatePreference
): PluginSchedulingRuleId {
  return `plugin:${plugin.id}:${rule.id}`;
}

function pluginRuleMatches(
  rule: PluginCandidatePreference,
  task: AssignmentTask
): boolean {
  const flightMatches =
    !rule.match.flightNo ||
    rule.match.flightNo.toUpperCase() === task.flight.flightNo.toUpperCase();
  const positionText = `${task.rule.name} ${task.rule.remark}`;
  return (
    flightMatches &&
    (!rule.match.positionKeyword ||
      positionText.includes(rule.match.positionKeyword))
  );
}

function pluginHooks(plugins: readonly PluginManifest[]): SchedulingHook[] {
  return plugins.flatMap((plugin) =>
    plugin.rules.map((rule) => ({
      id: pluginRuleId(plugin, rule),
      label: rule.label,
      stage: rule.stage,
      defaultEnabled: rule.enabled,
      configurable: true,
      before: [],
      after: [],
      source: `plugin:${plugin.id}` as const,
      execute: [
        {
          kind: "candidate-priority" as const,
          execute: ({ task, left, right }: CandidateComparisonContext) => {
            if (!pluginRuleMatches(rule, task)) return 0;
            return (
              Number(!rule.preferredStaffIds.includes(left.id)) -
              Number(!rule.preferredStaffIds.includes(right.id))
            );
          },
        },
      ] as const,
    }))
  );
}

export function createCandidateRulePlan(
  settings: ScheduleSettings,
  plugins: readonly PluginManifest[] = []
): CandidateRulePlanItem[] {
  const externalHooks = pluginHooks(plugins);
  const registry = createRuleRegistry([
    ...BUILT_IN_SCHEDULING_HOOKS,
    ...externalHooks,
  ]);
  const preferences: RulePreference[] = [
    ...builtInRulePreferences(settings),
    ...externalHooks.map((hook, index) => ({
      id: hook.id,
      enabled: hook.defaultEnabled,
      order: BUILT_IN_SCHEDULING_HOOKS.length + index,
    })),
  ];

  return registry.executionPlan(preferences).flatMap((hook) => {
    if (!hook.enabled) return [];
    return hook.execute.flatMap<CandidateRulePlanItem>((executor) =>
      executor.kind === "candidate-priority"
        ? [
            {
              id: hook.id as SchedulingRuleId | PluginSchedulingRuleId,
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
