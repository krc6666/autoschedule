import { describe, expect, it } from "vitest";

import { POST_SCHEDULE_REVIEW_STEPS } from "../../src/domain/kernel/schedule-review-contract";
import { createDefaultScheduleSettings } from "../../src/domain/rules/schedule-settings";
import {
  plannedScheduleProgress,
  postScheduleReviewPlan,
} from "../../src/domain/kernel/schedule-pipeline";

describe("schedule pipeline contract", () => {
  it("keeps post-schedule reviews in the documented order", () => {
    expect(POST_SCHEDULE_REVIEW_STEPS.map((step) => step.stage)).toEqual([
      "next-duty-rest",
      "late-shift-recovery",
      "late-shift-cutoff",
      "position-frequency",
      "position-rotation",
      "ke166-supervisor-finalize",
      "post-ke166-frequency-validation",
      "post-ke166-rotation-validation",
    ]);
  });

  it("owns the visible progress metadata for every review that reports progress", () => {
    const visible = POST_SCHEDULE_REVIEW_STEPS.filter(
      (step) => step.progress !== null
    );

    expect(visible.map((step) => step.progress?.percent)).toEqual([
      55, 65, 75, 85, 92, 96, 98,
    ]);
    expect(visible.every((step) => Boolean(step.progress?.label.trim()))).toBe(
      true
    );
    expect(
      new Set(POST_SCHEDULE_REVIEW_STEPS.map((step) => step.stage)).size
    ).toBe(POST_SCHEDULE_REVIEW_STEPS.length);
  });

  it("projects post reviews from the fixed hook order and named settings", () => {
    const settings = createDefaultScheduleSettings();
    settings.lateShiftRecoveryEnabled = false;

    const plan = postScheduleReviewPlan(settings);

    expect(plan.map((step) => step.stage)).not.toContain("late-shift-cutoff");
    expect(plan.map((step) => step.stage).slice(0, 2)).toEqual([
      "next-duty-rest",
      "position-frequency",
    ]);
    expect(plan.map((step) => step.stage)).toEqual(
      expect.arrayContaining([
        "ke166-supervisor-finalize",
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
    expect(stages.slice(0, 3)).toEqual(["prepare", "history", "assign"]);
    expect(stages.at(-1)).toBe("complete");
  });

  it("omits KE166 follow-up tasks when the current flights do not contain KE166", () => {
    const stages = plannedScheduleProgress(createDefaultScheduleSettings(), [
      { flightNo: "TR121" },
    ]).map((step) => step.stage);

    expect(stages).not.toContain("post-ke166-frequency-validation");
    expect(stages).not.toContain("post-ke166-rotation-validation");
  });
});
