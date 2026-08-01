import { describe, expect, it } from "vitest";

import { createDefaultScheduleSettings } from "../../src/domain/rules/schedule-settings";
import { createCandidateRulePlan } from "../../src/domain/rules/candidate-rule-plan";
import { CANDIDATE_PRIORITY_ORDER } from "../../src/domain/candidates/candidate-priority";

describe("candidate rule plan", () => {
  it("projects only the fixed typed built-in candidate rules", () => {
    const plan = createCandidateRulePlan(createDefaultScheduleSettings());

    expect(plan.map((rule) => rule.id)).toEqual(CANDIDATE_PRIORITY_ORDER);
    expect(plan.every((rule) => rule.source === "built-in")).toBe(true);
  });

  it("uses named business settings to disable their owned rules", () => {
    const settings = createDefaultScheduleSettings();
    settings.positionRotationEnabled = false;

    const ids = createCandidateRulePlan(settings).map((rule) => rule.id);

    expect(ids).not.toContain("position-frequency");
    expect(ids).not.toContain("priority-position-consecutive");
    expect(ids).not.toContain("high-fatigue-position-consecutive");
  });
});
