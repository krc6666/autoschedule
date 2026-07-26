import { describe, expect, it } from "vitest";

import {
  compareCandidatePriority,
  firstDifferentCandidateRule,
  CANDIDATE_PRIORITY_ORDER,
  SCHEDULING_RULES,
  SCHEDULING_STAGE_ORDER,
  type CandidatePriority
} from "./scheduling-policy";

function priority(overrides: Partial<CandidatePriority> = {}): CandidatePriority {
  return {
    dutyPosition: "unrelated",
    missingKe166SupervisorQualification: false,
    strictTransitionViolations: 0,
    preferredTransitionViolations: 0,
    scarceQualification: { futureTaskCount: 0, minimumEligibleStaff: null },
    alreadyAssignedToday: false,
    lateShiftRecovery: { protectedWorker: false, fatigueExcess: 0 },
    rollingLoadExcess: 0,
    highLoadRecoveryConflict: false,
    positionFrequency: { currentMonthCount: 0, recentWorkdayCount: 0 },
    workloadBalance: {
      violatesConfiguredTarget: false,
      todayHoursExcess: 0,
      rollingHoursExcess: 0,
      todayFatigueExcess: 0,
      todayHoursSpread: 0,
      rollingHoursSpread: 0,
      todayFatigueSpread: 0
    },
    historicalFatigue: 0,
    staffOrder: 0,
    ...overrides
  };
}

describe("scheduling policy contract", () => {
  it("keeps reserved assignments ahead of protection and fairness rules", () => {
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("ke166-supervisor")).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("workload-balance"));
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("staff-coverage")).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("position-transition"));
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("high-load-recovery")).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("position-frequency"));
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("position-frequency")).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("workload-balance"));
  });

  it("registers every candidate priority exactly once", () => {
    const registered = SCHEDULING_RULES.map((rule) => rule.id);
    expect(new Set(registered).size).toBe(registered.length);
    expect(CANDIDATE_PRIORITY_ORDER.every((ruleId) => registered.includes(ruleId))).toBe(true);
  });

  it("keeps every candidate rule inside the declared stage sequence", () => {
    const stageByRule = new Map(SCHEDULING_RULES.map((rule) => [rule.id, rule.stage]));
    const stageIndexes = CANDIDATE_PRIORITY_ORDER.map((ruleId) => SCHEDULING_STAGE_ORDER.indexOf(stageByRule.get(ruleId)!));
    expect(stageIndexes).toEqual([...stageIndexes].sort((left, right) => left - right));
  });

  it("compares strict and preferred transition violations in explicit sequence", () => {
    const strictViolation = priority({ strictTransitionViolations: 1 });
    const preferredViolations = priority({ preferredTransitionViolations: 20 });

    expect(compareCandidatePriority(strictViolation, preferredViolations)).toBeGreaterThan(0);
    expect(firstDifferentCandidateRule(strictViolation, preferredViolations)).toBe("position-transition");
  });

  it("prefers a lower same-position frequency before workload balancing", () => {
    const frequent = priority({ positionFrequency: { currentMonthCount: 4, recentWorkdayCount: 1 }, workloadBalance: { ...priority().workloadBalance, todayHoursExcess: 0 } });
    const lessFrequent = priority({ positionFrequency: { currentMonthCount: 1, recentWorkdayCount: 4 }, workloadBalance: { ...priority().workloadBalance, todayHoursExcess: 20 } });

    expect(compareCandidatePriority(frequent, lessFrequent)).toBeGreaterThan(0);
    expect(firstDifferentCandidateRule(frequent, lessFrequent)).toBe("position-frequency");
  });

  it("uses the recent-six-workday count only after the current-month count is tied", () => {
    const recentFrequent = priority({ positionFrequency: { currentMonthCount: 2, recentWorkdayCount: 4 } });
    const recentLessFrequent = priority({ positionFrequency: { currentMonthCount: 2, recentWorkdayCount: 1 } });

    expect(compareCandidatePriority(recentFrequent, recentLessFrequent)).toBeGreaterThan(0);
    expect(firstDifferentCandidateRule(recentFrequent, recentLessFrequent)).toBe("position-frequency");
  });

  it("registers frequency rebalancing in generation and continuous rotation after scheduling", () => {
    const frequencyReview = SCHEDULING_RULES.find((rule) => rule.id === "position-frequency-review");
    const rotation = SCHEDULING_RULES.find((rule) => rule.id === "position-rotation");
    expect(frequencyReview?.stage).toBe("protection");
    expect(rotation?.stage).toBe("post-schedule-review");
    expect(CANDIDATE_PRIORITY_ORDER).not.toContain("position-frequency-review");
    expect(CANDIDATE_PRIORITY_ORDER).not.toContain("position-rotation");
  });
});
