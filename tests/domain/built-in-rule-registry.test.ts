import { describe, expect, it } from "vitest";

import { createDefaultScheduleSettings } from "../../src/domain/rules/schedule-settings";
import {
  BUILT_IN_RULE_REGISTRY,
  builtInRulePreferences,
} from "../../src/domain/rules/built-in-rule-registry";
import { SCHEDULING_RULES } from "../../src/domain/rules/schedule-rule-contract";

describe("built-in rule registry", () => {
  it("owns every central rule exactly once and reserves KE166 before duty", () => {
    const plan = BUILT_IN_RULE_REGISTRY.executionPlan();

    expect(plan.map((hook) => hook.id).sort()).toEqual(
      SCHEDULING_RULES.map((rule) => rule.id).sort()
    );
    expect(
      plan.findIndex((hook) => hook.id === "ke166-supervisor")
    ).toBeLessThan(plan.findIndex((hook) => hook.id === "duty-position"));
  });

  it("projects named business settings into hook enablement without disabling mandatory rules", () => {
    const settings = createDefaultScheduleSettings();
    settings.positionRotationEnabled = false;
    const plan = BUILT_IN_RULE_REGISTRY.executionPlan(
      builtInRulePreferences(settings)
    );
    const enabled = new Map(plan.map((hook) => [hook.id, hook.enabled]));

    expect(enabled.get("position-rotation")).toBe(false);
    expect(enabled.get("position-frequency")).toBe(false);
    expect(enabled.get("workload-balance")).toBe(true);
    expect(enabled.get("staff-eligibility")).toBe(true);
    expect(enabled.get("ke166-supervisor")).toBe(true);
  });
});
