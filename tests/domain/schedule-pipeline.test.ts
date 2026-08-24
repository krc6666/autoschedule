import { describe, expect, it } from "vitest";

import { createDefaultScheduleSettings } from "../../src/domain/rules/schedule-settings";
import {
  SCHEDULE_PROGRESS_STAGES,
  visibleScheduleProgressStep,
} from "../../src/domain/kernel/schedule-progress";
import {
  plannedScheduleProgress,
  postScheduleReviewPlan,
} from "../../src/domain/kernel/schedule-pipeline";

describe("schedule pipeline contract", () => {
  it("keeps post-schedule reviews in the documented order", () => {
    expect(
      postScheduleReviewPlan(createDefaultScheduleSettings()).map(
        (step) => step.stage
      )
    ).toEqual([
      "late-priority-frequency",
      "position-frequency",
      "same-day-cross-flight-priority",
      "late-shift-recovery",
      "late-shift-cutoff",
      "position-rotation",
      "ke166-supervisor-finalize",
      "post-ke166-late-priority-frequency-validation",
      "post-ke166-frequency-validation",
      "post-ke166-rotation-validation",
    ]);
  });

  it("owns the visible progress metadata for every review that reports progress", () => {
    const plan = postScheduleReviewPlan(createDefaultScheduleSettings());
    const visible = plan.flatMap((step) => {
      const progress = visibleScheduleProgressStep(step.stage);
      return progress ? [progress] : [];
    });

    expect(visible.map((step) => step.percent)).toEqual([
      65, 75, 82, 85, 92, 95, 96, 98,
    ]);
    expect(visible.every((step) => Boolean(step.label.trim()))).toBe(true);
    expect(new Set(plan.map((step) => step.stage)).size).toBe(plan.length);
    expect(SCHEDULE_PROGRESS_STAGES.slice(3, -1)).toEqual(
      visible.map((step) => step.stage)
    );
  });

  it("projects post reviews from the fixed hook order and named settings", () => {
    const settings = createDefaultScheduleSettings();
    settings.lateShiftRecoveryEnabled = false;

    const plan = postScheduleReviewPlan(settings);

    expect(plan.map((step) => step.stage)).not.toContain("late-shift-cutoff");
    expect(plan.map((step) => step.stage)[0]).toBe("late-priority-frequency");
    expect(plan.map((step) => step.stage)).toEqual(
      expect.arrayContaining([
        "ke166-supervisor-finalize",
        "post-ke166-late-priority-frequency-validation",
        "post-ke166-frequency-validation",
        "post-ke166-rotation-validation",
      ])
    );
  });

  it("shows only the progress tasks that the enabled hook plan will execute", () => {
    const settings = createDefaultScheduleSettings();
    settings.lateShiftRecoveryEnabled = false;

    const stages = plannedScheduleProgress(settings, [
      { flightNo: "KE166" },
    ]).map((step) => step.stage);

    expect(stages).not.toContain("late-shift-cutoff");
    expect(stages.slice(0, 3)).toEqual(["prepare", "optimize", "assign"]);
    expect(stages.at(-1)).toBe("complete");
  });

  it("omits KE166 follow-up tasks when the current flights do not contain KE166", () => {
    const stages = plannedScheduleProgress(createDefaultScheduleSettings(), [
      { flightNo: "TR121" },
    ]).map((step) => step.stage);

    expect(stages).not.toContain("post-ke166-frequency-validation");
    expect(stages).not.toContain(
      "post-ke166-late-priority-frequency-validation"
    );
    expect(stages).not.toContain("post-ke166-rotation-validation");
  });
});
