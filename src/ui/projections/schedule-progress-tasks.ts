import type {
  ScheduleProgressStage,
  ScheduleProgressStep,
} from "../../domain/kernel/schedule-progress";

export type ScheduleProgressOutcome =
  "idle" | "running" | "completed" | "failed";
export type ScheduleProgressTaskStatus =
  "completed" | "active" | "pending" | "failed";

export interface ScheduleProgressTask extends ScheduleProgressStep {
  status: ScheduleProgressTaskStatus;
}

export function projectScheduleProgressTasks(
  steps: readonly ScheduleProgressStep[],
  currentStage: ScheduleProgressStage,
  outcome: ScheduleProgressOutcome
): readonly ScheduleProgressTask[] {
  const currentIndex = steps.findIndex((step) => step.stage === currentStage);
  return steps.map((step, index) => {
    let status: ScheduleProgressTaskStatus = "pending";
    if (outcome === "completed") status = "completed";
    else if (index < currentIndex) status = "completed";
    else if (index === currentIndex)
      status = outcome === "failed" ? "failed" : "active";
    return { ...step, status };
  });
}
