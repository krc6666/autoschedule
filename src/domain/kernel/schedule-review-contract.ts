export const POST_SCHEDULE_REVIEW_STEPS = [
  {
    stage: "late-shift-recovery",
    progress: { percent: 65, label: "保护上一班晚班人员" },
  },
  {
    stage: "late-shift-cutoff",
    progress: { percent: 75, label: "检查末班人员下班保护" },
  },
  {
    stage: "late-priority-frequency",
    progress: { percent: 82, label: "检查末班重点岗位轮换" },
  },
  {
    stage: "position-frequency",
    progress: { percent: 85, label: "检查重点岗位轮换" },
  },
  {
    stage: "position-rotation",
    progress: { percent: 92, label: "检查连续轮岗" },
  },
  { stage: "ke166-supervisor-finalize", progress: null },
  {
    stage: "post-ke166-late-priority-frequency-validation",
    progress: { percent: 95, label: "复查机动督导后的末班轮换" },
  },
  {
    stage: "post-ke166-frequency-validation",
    progress: { percent: 96, label: "复查机动督导后的岗位轮换" },
  },
  {
    stage: "post-ke166-rotation-validation",
    progress: { percent: 98, label: "复查机动督导后的连续轮岗" },
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
