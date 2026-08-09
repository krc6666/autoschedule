import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("人员资格检查职责边界", () => {
  it("共享事实计算，但保留自动和人工各自的裁决入口", () => {
    const root = process.cwd();
    const candidates = join(root, "src", "domain", "candidates");
    const factsPath = join(candidates, "assignment-eligibility-facts.ts");
    const eligibilityPath = join(candidates, "assignment-eligibility.ts");
    const scheduleActionsPath = join(root, "src", "app", "schedule-actions.ts");

    expect(existsSync(factsPath)).toBe(true);

    const facts = readFileSync(factsPath, "utf8");
    const eligibility = readFileSync(eligibilityPath, "utf8");
    const scheduleActions = readFileSync(scheduleActionsPath, "utf8");

    expect(eligibility).toContain('from "./assignment-eligibility-facts"');
    expect(eligibility).toContain("diagnoseAutomaticAssignmentEligibility");
    expect(eligibility).toContain("diagnoseManualAssignmentEligibility");
    expect(eligibility).not.toContain("staffConflicts(");
    expect(eligibility).not.toContain("projectedAssignedHours(");
    expect(eligibility).not.toContain("intervalsOverlap(");
    expect(facts).not.toContain('from "./assignment-eligibility"');
    expect(scheduleActions).toContain("canAssignStaff");
    expect(scheduleActions).not.toContain("assignment-eligibility-facts");
  });
});
