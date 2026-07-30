import {
  hasPostScheduleReviewProgress,
  POST_SCHEDULE_REVIEW_STEPS,
} from "./schedule-review-contract";

const SCHEDULE_START_PROGRESS = [
  { stage: "prepare", percent: 5, label: "正在准备航班和岗位" },
  { stage: "history", percent: 15, label: "正在读取历史排班与轮值" },
  { stage: "assign", percent: 30, label: "正在分配岗位候选人员" },
] as const;

const POST_SCHEDULE_REVIEW_PROGRESS = POST_SCHEDULE_REVIEW_STEPS.filter(
  hasPostScheduleReviewProgress
).map(({ stage, progress }) => ({ stage, ...progress }));

export const SCHEDULE_PROGRESS = [
  ...SCHEDULE_START_PROGRESS,
  ...POST_SCHEDULE_REVIEW_PROGRESS,
  { stage: "complete", percent: 100, label: "排班计算完成" },
] as const;

export type ScheduleProgressStage = (typeof SCHEDULE_PROGRESS)[number]["stage"];

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
