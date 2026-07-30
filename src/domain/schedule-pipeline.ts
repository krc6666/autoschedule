import type { AppState, Assignment } from "../model";
import { reviewLateShiftCutoff } from "./late-shift-cutoff-review";
import { reviewLateShiftRecovery } from "./late-shift-recovery-review";
import { reviewNextDutyRest } from "./next-duty-rest-review";
import { reviewSamePositionFrequency } from "./position-frequency-review";
import { reviewConsecutivePositionRotation } from "./position-rotation-review";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import {
  hasPostScheduleReviewProgress,
  POST_SCHEDULE_REVIEW_STEPS,
  type PostScheduleReviewProgressStage,
  type PostScheduleReviewStage,
} from "./schedule-review-contract";

export interface SchedulePipelineContext {
  state: AppState;
  assignments: Assignment[];
  date: string;
  lockedAssignmentIds: ReadonlySet<string>;
  runFacts: ScheduleRunFacts;
  onProgress?: (
    stage: PostScheduleReviewProgressStage,
    percent: number
  ) => void;
  finalizeKe166Supervisor: () => void;
}

type PostScheduleReviewHandler = (context: SchedulePipelineContext) => string[];

const POST_SCHEDULE_REVIEW_HANDLERS: Readonly<
  Record<PostScheduleReviewStage, PostScheduleReviewHandler>
> = {
  "next-duty-rest": (context) =>
    reviewNextDutyRest(
      context.state,
      context.assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  "late-shift-recovery": (context) =>
    reviewLateShiftRecovery(
      context.state,
      context.assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  "late-shift-cutoff": (context) =>
    reviewLateShiftCutoff(
      context.state,
      context.assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  "position-frequency": (context) =>
    reviewSamePositionFrequency(
      context.state,
      context.assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  "position-rotation": (context) =>
    reviewConsecutivePositionRotation(
      context.state,
      context.assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  "ke166-supervisor-finalize": (context) => {
    context.finalizeKe166Supervisor();
    return [];
  },
  "post-ke166-frequency-validation": (context) =>
    reviewSamePositionFrequency(
      context.state,
      context.assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  "post-ke166-rotation-validation": (context) =>
    reviewConsecutivePositionRotation(
      context.state,
      context.assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
};

export function runPostSchedulePipeline(
  context: SchedulePipelineContext
): string[] {
  const warnings: string[] = [];
  for (const step of POST_SCHEDULE_REVIEW_STEPS) {
    if (hasPostScheduleReviewProgress(step)) {
      context.onProgress?.(step.stage, step.progress.percent);
    }
    warnings.push(...POST_SCHEDULE_REVIEW_HANDLERS[step.stage](context));
  }
  return warnings;
}
