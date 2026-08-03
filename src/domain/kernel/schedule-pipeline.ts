import type { Flight, ScheduleSettings } from "../../model";
import {
  BUILT_IN_RULE_REGISTRY,
  builtInRulePreferences,
} from "../rules/built-in-rule-registry";
import type {
  ScheduleMutationContext,
  ScheduleMutationExecutor,
} from "../rules/rule-registry";
import {
  scheduleProgressStep,
  type ScheduleProgressStage,
  type ScheduleProgressStep,
} from "./schedule-progress";

export interface SchedulePipelineContext extends ScheduleMutationContext {
  onProgress?: (stage: ScheduleProgressStage, percent: number) => void;
}

export interface PlannedScheduleMutation {
  ruleId: string;
  label: string;
  stage: string;
  executor: ScheduleMutationExecutor;
}

function mutationExecutors(
  settings: ScheduleSettings,
  kind: ScheduleMutationExecutor["kind"]
): PlannedScheduleMutation[] {
  const plan = BUILT_IN_RULE_REGISTRY.executionPlan(
    builtInRulePreferences(settings)
  );
  const collect = (
    pass: ScheduleMutationExecutor["pass"]
  ): PlannedScheduleMutation[] =>
    plan.flatMap((hook) => {
      if (!hook.enabled) return [];
      return hook.execute.flatMap<PlannedScheduleMutation>((executor) =>
        executor.kind === kind && executor.pass === pass
          ? [
              {
                ruleId: hook.id,
                label: hook.label,
                stage: executor.id,
                executor,
              },
            ]
          : []
      );
    });

  return [
    ...collect("primary"),
    ...collect("ke166-finalize"),
    ...collect("after-ke166"),
  ];
}

export function coverageHookPlan(
  settings: ScheduleSettings
): PlannedScheduleMutation[] {
  return mutationExecutors(settings, "coverage");
}

export function postScheduleReviewPlan(
  settings: ScheduleSettings
): PlannedScheduleMutation[] {
  return mutationExecutors(settings, "post-schedule");
}

export function plannedScheduleProgress(
  settings: ScheduleSettings,
  flights: readonly Pick<Flight, "flightNo">[]
): readonly ScheduleProgressStep[] {
  const mutationStages = [
    ...coverageHookPlan(settings),
    ...postScheduleReviewPlan(settings),
  ]
    .filter((item) => mutationApplies(item, flights))
    .flatMap((item) =>
      item.executor.progress ? [item.executor.progress.stage] : []
    );
  const stages: ScheduleProgressStage[] = [
    "prepare",
    "optimize",
    "assign",
    ...mutationStages,
    "complete",
  ];
  return [...new Set(stages)].map(scheduleProgressStep);
}

function mutationApplies(
  item: PlannedScheduleMutation,
  flights: readonly Pick<Flight, "flightNo">[]
): boolean {
  return !(
    item.executor.pass === "after-ke166" &&
    !flights.some((flight) => /^KE\s*166$/i.test(flight.flightNo.trim()))
  );
}

async function runPlan(
  context: SchedulePipelineContext,
  plan: readonly PlannedScheduleMutation[]
): Promise<string[]> {
  const warnings: string[] = [];
  for (const item of plan) {
    if (!mutationApplies(item, context.flights)) continue;
    const progress = item.executor.progress;
    if (progress) context.onProgress?.(progress.stage, progress.percent);
    const proposal = await item.executor.execute(context);
    if (proposal.assignments) {
      context.ledger.commit({
        type: "replace",
        assignments: proposal.assignments,
      });
    }
    warnings.push(...proposal.warnings);
  }
  return warnings;
}

export function runCoveragePipeline(
  context: SchedulePipelineContext
): Promise<string[]> {
  return runPlan(context, coverageHookPlan(context.state.settings));
}

export function runPostSchedulePipeline(
  context: SchedulePipelineContext
): Promise<string[]> {
  return runPlan(context, postScheduleReviewPlan(context.state.settings));
}
