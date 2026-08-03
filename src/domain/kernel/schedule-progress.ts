import {
  hasPostScheduleReviewProgress,
  POST_SCHEDULE_REVIEW_STEPS,
} from "./schedule-review-contract";

const SCHEDULE_START_PROGRESS = [
  { stage: "prepare", percent: 5, label: "准备航班和岗位" },
  { stage: "optimize", percent: 15, label: "整体计算岗位与人员" },
  { stage: "assign", percent: 30, label: "整理班表和特殊岗位" },
] as const;

const POST_SCHEDULE_REVIEW_PROGRESS = POST_SCHEDULE_REVIEW_STEPS.filter(
  hasPostScheduleReviewProgress
).map(({ stage, progress }) => ({ stage, ...progress }));

export const SCHEDULE_PROGRESS = [
  ...SCHEDULE_START_PROGRESS,
  ...POST_SCHEDULE_REVIEW_PROGRESS,
  { stage: "complete", percent: 100, label: "排班完成" },
] as const;

export type ScheduleProgressStage = (typeof SCHEDULE_PROGRESS)[number]["stage"];
export interface ScheduleProgressStep {
  stage: ScheduleProgressStage;
  percent: number;
  label: string;
}

const PROGRESS_BY_STAGE: ReadonlyMap<
  ScheduleProgressStage,
  (typeof SCHEDULE_PROGRESS)[number]
> = new Map(SCHEDULE_PROGRESS.map((item) => [item.stage, item]));

export const SCHEDULE_PROGRESS_STAGES: readonly ScheduleProgressStage[] =
  SCHEDULE_PROGRESS.map((item) => item.stage);

export function scheduleProgressPercent(stage: ScheduleProgressStage): number {
  return PROGRESS_BY_STAGE.get(stage)!.percent;
}

export function scheduleProgressLabel(stage: ScheduleProgressStage): string {
  return PROGRESS_BY_STAGE.get(stage)!.label;
}

export function scheduleProgressStep(
  stage: ScheduleProgressStage
): ScheduleProgressStep {
  const step = PROGRESS_BY_STAGE.get(stage)!;
  return { stage: step.stage, percent: step.percent, label: step.label };
}
