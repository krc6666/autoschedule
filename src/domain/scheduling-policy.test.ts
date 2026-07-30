import { describe, expect, it } from "vitest";

import {
  CANDIDATE_PRIORITY_ORDER,
  compareCandidatePriority,
  firstDifferentCandidateRule,
  type CandidatePriority,
} from "./candidate-priority";
import {
  RULE_FEEDBACK_ORDER,
  SCHEDULING_RULES,
  SCHEDULING_STAGE_ORDER,
} from "../schedule-rule-contract";
import {
  isHighFatigueOrdinaryRotationPosition,
  isPriorityRotationPosition,
} from "./position-rotation-policy";

function priority(
  overrides: Partial<CandidatePriority> = {}
): CandidatePriority {
  return {
    dutyPosition: "unrelated",
    strictTransitionViolations: 0,
    preferredTransitionViolations: 0,
    scarceQualification: { futureTaskCount: 0, minimumEligibleStaff: null },
    alreadyAssignedToday: false,
    nextDutyRestConflict: false,
    lateShiftRecovery: {
      protectedMorningTarget: false,
      protectedLatePriorityTarget: false,
    },
    lateShiftCutoff: {
      disposition: "unprotected",
      cutoffMinutes: null,
      previousEndMinutes: null,
    },
    repeatedPriorityPosition: false,
    repeatedHighFatiguePosition: false,
    unavoidableLaterTask: false,
    rollingLoadExcess: 0,
    highLoadRecoveryConflict: false,
    previousWorkdayLoad: {
      fatiguePoints: 0,
      latestEndMinutes: 0,
      workHours: 0,
      priorityPositionCount: 0,
    },
    positionFrequency: { currentMonthCount: 0, recentWorkdayCount: 0 },
    workloadBalance: {
      violatesConfiguredTarget: false,
      todayHoursExcess: 0,
      rollingHoursExcess: 0,
      todayFatigueExcess: 0,
      todayHoursSpread: 0,
      rollingHoursSpread: 0,
      todayFatigueSpread: 0,
    },
    historicalFatigue: 0,
    staffOrder: 0,
    ...overrides,
  };
}

describe("scheduling policy contract", () => {
  it("classifies only configured regular priority positions for frequency balancing", () => {
    for (const keyword of ["一号", "申报", "督导", "控制", "送资料"]) {
      expect(
        isPriorityRotationPosition({
          category: "常规",
          name: "G20",
          remark: keyword,
        })
      ).toBe(true);
    }
    expect(
      isPriorityRotationPosition({ category: "常规", name: "G15", remark: "" })
    ).toBe(false);
    expect(
      isPriorityRotationPosition({
        category: "机动督导",
        name: "督导",
        remark: "",
      })
    ).toBe(false);
    expect(
      isPriorityRotationPosition({
        category: "行政支援",
        name: "督导",
        remark: "",
      })
    ).toBe(false);
  });

  it("classifies high-fatigue ordinary positions from the configured threshold", () => {
    expect(
      isHighFatigueOrdinaryRotationPosition(
        { category: "常规", name: "H03", remark: "", fatiguePoints: 6 },
        4
      )
    ).toBe(true);
    expect(
      isHighFatigueOrdinaryRotationPosition(
        { category: "常规", name: "H07", remark: "", fatiguePoints: 2 },
        4
      )
    ).toBe(false);
    expect(
      isHighFatigueOrdinaryRotationPosition(
        { category: "常规", name: "H02", remark: "一号", fatiguePoints: 10 },
        4
      )
    ).toBe(false);
    expect(
      isHighFatigueOrdinaryRotationPosition(
        { category: "引导", name: "柜台引导", remark: "", fatiguePoints: 6 },
        4
      )
    ).toBe(false);
  });

  it("keeps reserved assignments ahead of protection and fairness rules", () => {
    expect(CANDIDATE_PRIORITY_ORDER).not.toContain("ke166-supervisor");
    expect(
      SCHEDULING_RULES.find((rule) => rule.id === "ke166-supervisor")
    ).toMatchObject({
      stage: "post-schedule-review",
      label: "KE166独立督导后置安排、轮岗兼任与缺员兼任",
    });
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("position-transition")
    ).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("next-duty-rest"));
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("next-duty-rest")).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("late-shift-recovery")
    );
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("late-shift-recovery")
    ).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("late-shift-cutoff"));
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("late-shift-cutoff")).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("priority-position-consecutive")
    );
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("priority-position-consecutive")
    ).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("high-fatigue-position-consecutive")
    );
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("high-fatigue-position-consecutive")
    ).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("same-day-late-obligation")
    );
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("priority-position-consecutive")
    ).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("staff-coverage"));
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("priority-position-consecutive")
    ).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("same-day-late-obligation")
    );
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("same-day-late-obligation")
    ).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("staff-coverage"));
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("late-shift-cutoff")).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("preferred-position-transition")
    );
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("position-transition")
    ).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("late-shift-recovery"));
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("late-shift-recovery")
    ).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("preferred-position-transition")
    );
    expect(
      CANDIDATE_PRIORITY_ORDER.indexOf("late-shift-recovery")
    ).toBeLessThan(CANDIDATE_PRIORITY_ORDER.indexOf("staff-coverage"));
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("high-load-recovery")).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("position-frequency")
    );
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("high-load-recovery")).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("cross-workday-load")
    );
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("cross-workday-load")).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("position-frequency")
    );
    expect(CANDIDATE_PRIORITY_ORDER.indexOf("position-frequency")).toBeLessThan(
      CANDIDATE_PRIORITY_ORDER.indexOf("workload-balance")
    );
  });

  it("prefers a non-protected worker for a priority position before other soft protections", () => {
    const protectedWorker = priority({
      nextDutyRestConflict: true,
      lateShiftRecovery: {
        protectedMorningTarget: false,
        protectedLatePriorityTarget: false,
      },
    });
    const availableWorker = priority({
      nextDutyRestConflict: false,
      lateShiftRecovery: {
        protectedMorningTarget: true,
        protectedLatePriorityTarget: false,
      },
    });

    expect(
      compareCandidatePriority(protectedWorker, availableWorker)
    ).toBeGreaterThan(0);
    expect(firstDifferentCandidateRule(protectedWorker, availableWorker)).toBe(
      "next-duty-rest"
    );
  });

  it("uses a protected worker before their cutoff but prefers an unprotected worker after the cutoff", () => {
    const beforeCutoff = priority({
      lateShiftCutoff: {
        disposition: "before-cutoff",
        cutoffMinutes: 900,
        previousEndMinutes: 1435,
      },
    });
    const afterCutoff = priority({
      lateShiftCutoff: {
        disposition: "after-cutoff",
        cutoffMinutes: 900,
        previousEndMinutes: 1435,
      },
    });
    const unprotected = priority();

    expect(compareCandidatePriority(beforeCutoff, unprotected)).toBeLessThan(0);
    expect(compareCandidatePriority(afterCutoff, unprotected)).toBeGreaterThan(
      0
    );
    expect(firstDifferentCandidateRule(beforeCutoff, unprotected)).toBe(
      "late-shift-cutoff"
    );
    expect(firstDifferentCandidateRule(afterCutoff, unprotected)).toBe(
      "late-shift-cutoff"
    );
  });

  it("prevents a repeated priority position before staff coverage and frequency balancing", () => {
    const repeated = priority({
      repeatedPriorityPosition: true,
      alreadyAssignedToday: false,
      positionFrequency: { currentMonthCount: 0, recentWorkdayCount: 0 },
    });
    const alternate = priority({
      repeatedPriorityPosition: false,
      alreadyAssignedToday: true,
      positionFrequency: { currentMonthCount: 5, recentWorkdayCount: 5 },
    });

    expect(compareCandidatePriority(repeated, alternate)).toBeGreaterThan(0);
    expect(firstDifferentCandidateRule(repeated, alternate)).toBe(
      "priority-position-consecutive"
    );
  });

  it("prevents a repeated high-fatigue ordinary position before same-day and workload balancing", () => {
    const repeated = priority({
      repeatedHighFatiguePosition: true,
      unavoidableLaterTask: false,
      workloadBalance: {
        violatesConfiguredTarget: false,
        todayHoursExcess: 0,
        rollingHoursExcess: 0,
        todayFatigueExcess: 0,
        todayHoursSpread: 0,
        rollingHoursSpread: 0,
        todayFatigueSpread: 0,
      },
    });
    const alternate = priority({
      repeatedHighFatiguePosition: false,
      unavoidableLaterTask: true,
      workloadBalance: {
        violatesConfiguredTarget: true,
        todayHoursExcess: 10,
        rollingHoursExcess: 10,
        todayFatigueExcess: 10,
        todayHoursSpread: 10,
        rollingHoursSpread: 10,
        todayFatigueSpread: 10,
      },
    });

    expect(compareCandidatePriority(repeated, alternate)).toBeGreaterThan(0);
    expect(firstDifferentCandidateRule(repeated, alternate)).toBe(
      "high-fatigue-position-consecutive"
    );
  });

  it("gives earlier cutoffs and later previous finishes first access to before-cutoff work", () => {
    const earlierCutoff = priority({
      lateShiftCutoff: {
        disposition: "before-cutoff",
        cutoffMinutes: 840,
        previousEndMinutes: 1410,
      },
    });
    const laterCutoff = priority({
      lateShiftCutoff: {
        disposition: "before-cutoff",
        cutoffMinutes: 960,
        previousEndMinutes: 1440,
      },
    });
    const laterPreviousFinish = priority({
      lateShiftCutoff: {
        disposition: "before-cutoff",
        cutoffMinutes: 840,
        previousEndMinutes: 1450,
      },
    });

    expect(compareCandidatePriority(earlierCutoff, laterCutoff)).toBeLessThan(
      0
    );
    expect(
      compareCandidatePriority(laterPreviousFinish, earlierCutoff)
    ).toBeLessThan(0);
  });

  it("registers every candidate priority exactly once", () => {
    const registered = SCHEDULING_RULES.map((rule) => rule.id);
    expect(new Set(registered).size).toBe(registered.length);
    expect(
      CANDIDATE_PRIORITY_ORDER.every((ruleId) => registered.includes(ruleId))
    ).toBe(true);
  });

  it("declares how every rule participates in feedback", () => {
    expect(
      SCHEDULING_RULES.every((rule) =>
        ["dedicated", "aggregated", "decision-only"].includes(rule.feedbackMode)
      )
    ).toBe(true);
    const dedicatedKeys = SCHEDULING_RULES.flatMap((rule) =>
      rule.feedbackMode === "dedicated" ? [rule.feedbackKey] : []
    );
    expect(new Set(RULE_FEEDBACK_ORDER)).toEqual(new Set(dedicatedKeys));
  });

  it("keeps every candidate rule inside the declared stage sequence", () => {
    const stageByRule = new Map(
      SCHEDULING_RULES.map((rule) => [rule.id, rule.stage])
    );
    const stageIndexes = CANDIDATE_PRIORITY_ORDER.map((ruleId) =>
      SCHEDULING_STAGE_ORDER.indexOf(stageByRule.get(ruleId)!)
    );
    expect(stageIndexes).toEqual(
      [...stageIndexes].sort((left, right) => left - right)
    );
  });

  it("compares strict and preferred transition violations in explicit sequence", () => {
    const strictViolation = priority({ strictTransitionViolations: 1 });
    const preferredViolations = priority({ preferredTransitionViolations: 20 });

    expect(
      compareCandidatePriority(strictViolation, preferredViolations)
    ).toBeGreaterThan(0);
    expect(
      firstDifferentCandidateRule(strictViolation, preferredViolations)
    ).toBe("position-transition");
    expect(firstDifferentCandidateRule(priority(), preferredViolations)).toBe(
      "preferred-position-transition"
    );
  });

  it("prefers a lower same-position frequency before workload balancing", () => {
    const frequent = priority({
      positionFrequency: { currentMonthCount: 4, recentWorkdayCount: 1 },
      workloadBalance: { ...priority().workloadBalance, todayHoursExcess: 0 },
    });
    const lessFrequent = priority({
      positionFrequency: { currentMonthCount: 1, recentWorkdayCount: 4 },
      workloadBalance: { ...priority().workloadBalance, todayHoursExcess: 20 },
    });

    expect(compareCandidatePriority(frequent, lessFrequent)).toBeGreaterThan(0);
    expect(firstDifferentCandidateRule(frequent, lessFrequent)).toBe(
      "position-frequency"
    );
  });

  it("uses previous-workday load before monthly position frequency", () => {
    const heavierPrevious = priority({
      previousWorkdayLoad: {
        fatiguePoints: 10,
        latestEndMinutes: 1200,
        workHours: 8,
        priorityPositionCount: 2,
      },
      positionFrequency: { currentMonthCount: 0, recentWorkdayCount: 0 },
    });
    const lighterPrevious = priority({
      previousWorkdayLoad: {
        fatiguePoints: 1,
        latestEndMinutes: 600,
        workHours: 2,
        priorityPositionCount: 0,
      },
      positionFrequency: { currentMonthCount: 5, recentWorkdayCount: 5 },
    });

    expect(
      compareCandidatePriority(heavierPrevious, lighterPrevious)
    ).toBeGreaterThan(0);
    expect(firstDifferentCandidateRule(heavierPrevious, lighterPrevious)).toBe(
      "cross-workday-load"
    );
  });

  it("uses the recent-six-workday count only after the current-month count is tied", () => {
    const recentFrequent = priority({
      positionFrequency: { currentMonthCount: 2, recentWorkdayCount: 4 },
    });
    const recentLessFrequent = priority({
      positionFrequency: { currentMonthCount: 2, recentWorkdayCount: 1 },
    });

    expect(
      compareCandidatePriority(recentFrequent, recentLessFrequent)
    ).toBeGreaterThan(0);
    expect(
      firstDifferentCandidateRule(recentFrequent, recentLessFrequent)
    ).toBe("position-frequency");
  });

  it("registers frequency rebalancing in generation and continuous rotation after scheduling", () => {
    const frequencyReview = SCHEDULING_RULES.find(
      (rule) => rule.id === "position-frequency-review"
    );
    const rotation = SCHEDULING_RULES.find(
      (rule) => rule.id === "position-rotation"
    );
    expect(frequencyReview?.stage).toBe("protection");
    expect(rotation?.stage).toBe("post-schedule-review");
    expect(CANDIDATE_PRIORITY_ORDER).not.toContain("position-frequency-review");
    expect(CANDIDATE_PRIORITY_ORDER).not.toContain("position-rotation");
  });
});
