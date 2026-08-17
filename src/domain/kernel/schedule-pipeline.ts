import type { Flight, ScheduleSettings } from "../../model";
import type { ScheduleMutationContext } from "../rules/rule-registry";
import {
  compileSchedulingPlan,
  postScheduleMutationApplies,
  type PlannedScheduleMutation,
} from "../rules/scheduling-execution-plan";
import {
  scheduleProgressStep,
  type ScheduleProgressStage,
  type ScheduleProgressStep,
  visibleScheduleProgressStep,
} from "./schedule-progress";

export interface SchedulePipelineContext extends ScheduleMutationContext {
  onProgress?: (stage: ScheduleProgressStage, percent: number) => void;
}

export function coverageHookPlan(
  settings: ScheduleSettings
): PlannedScheduleMutation[] {
  return [...compileSchedulingPlan(settings).coverageMutations];
}

export function postScheduleReviewPlan(
  settings: ScheduleSettings
): PlannedScheduleMutation[] {
  return [...compileSchedulingPlan(settings).postScheduleMutations];
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
      visibleScheduleProgressStep(item.stage) ? [item.stage] : []
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
  return postScheduleMutationApplies(item, flights);
}

async function runPlan(
  context: SchedulePipelineContext,
  plan: readonly PlannedScheduleMutation[]
): Promise<string[]> {
  const warnings: string[] = [];
  for (const item of plan) {
    if (!mutationApplies(item, context.flights)) continue;
    const progress = visibleScheduleProgressStep(item.stage);
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
