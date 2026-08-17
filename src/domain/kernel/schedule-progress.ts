import { createDefaultScheduleSettings } from "../rules/schedule-settings";
import { compileSchedulingPlan } from "../rules/scheduling-execution-plan";

export type ScheduleProgressStage = string;
export interface ScheduleProgressStep {
  stage: ScheduleProgressStage;
  percent: number;
  label: string;
}

const SCHEDULE_START_PROGRESS = [
  { stage: "prepare", percent: 5, label: "准备航班和岗位" },
  { stage: "optimize", percent: 15, label: "整体计算岗位与人员" },
  { stage: "assign", percent: 30, label: "整理班表和特殊岗位" },
] as const;

const POST_SCHEDULE_PROGRESS_METADATA: Readonly<
  Record<string, Omit<ScheduleProgressStep, "stage">>
> = {
  "late-priority-frequency": {
    percent: 65,
    label: "检查末班重点岗位轮换",
  },
  "position-frequency": { percent: 75, label: "检查重点岗位轮换" },
  "late-shift-recovery": { percent: 82, label: "保护上一班晚班人员" },
  "late-shift-cutoff": { percent: 85, label: "检查末班人员下班保护" },
  "position-rotation": { percent: 92, label: "检查连续轮岗" },
  "post-ke166-late-priority-frequency-validation": {
    percent: 95,
    label: "复查机动督导后的末班轮换",
  },
  "post-ke166-frequency-validation": {
    percent: 96,
    label: "复查机动督导后的岗位轮换",
  },
  "post-ke166-rotation-validation": {
    percent: 98,
    label: "复查机动督导后的连续轮岗",
  },
};

const POST_SCHEDULE_REVIEW_PROGRESS: readonly ScheduleProgressStep[] =
  compileSchedulingPlan(
    createDefaultScheduleSettings()
  ).postScheduleMutations.flatMap((item) => {
    const metadata = POST_SCHEDULE_PROGRESS_METADATA[item.stage];
    return metadata ? [{ stage: item.stage, ...metadata }] : [];
  });

export const SCHEDULE_PROGRESS: readonly ScheduleProgressStep[] = [
  ...SCHEDULE_START_PROGRESS,
  ...POST_SCHEDULE_REVIEW_PROGRESS,
  { stage: "complete", percent: 100, label: "排班完成" },
] as const;

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

export function visibleScheduleProgressStep(
  stage: ScheduleProgressStage
): ScheduleProgressStep | null {
  const step = PROGRESS_BY_STAGE.get(stage);
  return step
    ? { stage: step.stage, percent: step.percent, label: step.label }
    : null;
}
