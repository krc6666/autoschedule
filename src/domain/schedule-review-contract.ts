export const POST_SCHEDULE_REVIEW_STEPS = [
  {
    stage: "next-duty-rest",
    progress: { percent: 55, label: "正在检查下班次值班预休" },
  },
  {
    stage: "late-shift-recovery",
    progress: { percent: 65, label: "正在检查跨工作日恢复" },
  },
  {
    stage: "late-shift-cutoff",
    progress: { percent: 75, label: "正在检查末班人员下班保护" },
  },
  {
    stage: "position-frequency",
    progress: { percent: 85, label: "正在复核重点岗位频率" },
  },
  {
    stage: "position-rotation",
    progress: { percent: 92, label: "正在复核连续轮岗" },
  },
  { stage: "ke166-supervisor-finalize", progress: null },
  {
    stage: "post-ke166-frequency-validation",
    progress: { percent: 96, label: "正在验收机动督导绑定后的岗位频率" },
  },
  {
    stage: "post-ke166-rotation-validation",
    progress: { percent: 98, label: "正在验收机动督导绑定后的连续轮岗" },
  },
] as const;

export type PostScheduleReviewStep =
  (typeof POST_SCHEDULE_REVIEW_STEPS)[number];
export type PostScheduleReviewStage = PostScheduleReviewStep["stage"];
export type VisiblePostScheduleReviewStep = Exclude<
  PostScheduleReviewStep,
  { progress: null }
>;
export type PostScheduleReviewProgressStage =
  VisiblePostScheduleReviewStep["stage"];

export function hasPostScheduleReviewProgress(
  step: PostScheduleReviewStep
): step is VisiblePostScheduleReviewStep {
  return step.progress !== null;
}
