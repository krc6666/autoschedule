import { describe, expect, it } from "vitest";

import { POST_SCHEDULE_REVIEW_STEPS } from "./schedule-review-contract";

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
});
