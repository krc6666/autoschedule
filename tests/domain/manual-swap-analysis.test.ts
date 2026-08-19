import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { analyzeManualSwap } from "../../src/domain/reviews/manual-swap-analysis";
import type { AppState, Assignment } from "../../src/model";

function swapFixture(): {
  state: AppState;
  target: Assignment;
  candidate: Assignment;
} {
  const state = createDefaultState();
  state.settings.rollingLoadProtectionEnabled = false;
  state.staff = [
    {
      id: "worker-a",
      name: "甲员工",
      staffType: "常规",
      teamLeader: false,
      cxPreflightQualified: false,
      dutyQualified: false,
      standbyQualified: true,
      nightShift: true,
      status: "正常",
      remark: "",
    },
    {
      id: "worker-b",
      name: "乙员工",
      staffType: "常规",
      teamLeader: false,
      cxPreflightQualified: false,
      dutyQualified: false,
      standbyQualified: true,
      nightShift: true,
      status: "正常",
      remark: "",
    },
  ];
  const flight = state.flights.find((item) => item.flightNo === "TR121")!;
  const h02 = state.positionRules.find(
    (item) => item.flightNo === "TR121" && item.name === "H02"
  )!;
  const h08 = state.positionRules.find(
    (item) => item.flightNo === "TR121" && item.name === "H08"
  )!;
  h02.qualifiedStaffIds = state.staff.map((person) => person.id);
  h08.qualifiedStaffIds = state.staff.map((person) => person.id);
  const target: Assignment = {
    id: "target",
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: h02.id,
    position: h02.name,
    staffId: "worker-a",
    staffName: "甲员工",
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: 2,
    fatiguePoints: 10,
    remark: "一号",
    manualRemark: "",
    status: "assigned",
    decisionTrace: [
      {
        ruleId: "late-shift-recovery",
        stage: "protection",
        outcome: "fallback",
        message: "甲员工上一班承担末班重点岗位，本班仍承担较重岗位",
      },
    ],
  };
  const candidate: Assignment = {
    ...target,
    id: "candidate",
    positionRuleId: h08.id,
    position: h08.name,
    staffId: "worker-b",
    staffName: "乙员工",
    fatiguePoints: 2,
    remark: "",
    decisionTrace: undefined,
  };
  state.assignments = [target, candidate];
  state.activeScheduleDate = "2026-08-21";
  return { state, target, candidate };
}

describe("manual swap analysis", () => {
  it("simulates a safe two-person swap without changing the current schedule", () => {
    const { state, target, candidate } = swapFixture();
    const before = structuredClone(state.assignments);

    const analysis = analyzeManualSwap(
      state,
      "2026-08-21",
      target.id,
      candidate.id
    );

    expect(analysis.blockers).toEqual([]);
    expect(analysis.tradeoffs).toEqual([]);
    expect(analysis.outcome).toBe("safe");
    expect(analysis.changes).toEqual([
      expect.objectContaining({
        assignmentId: "target",
        beforeStaffName: "甲员工",
        afterStaffName: "乙员工",
      }),
      expect.objectContaining({
        assignmentId: "candidate",
        beforeStaffName: "乙员工",
        afterStaffName: "甲员工",
      }),
    ]);
    expect(analysis.improvements.join(" ")).toContain("甲员工");
    expect(state.assignments).toEqual(before);
  });

  it("reports missing target qualification as an executable manual tradeoff", () => {
    const { state, target, candidate } = swapFixture();
    state.positionRules.find(
      (item) => item.id === target.positionRuleId
    )!.qualifiedStaffIds = ["worker-a"];

    const analysis = analyzeManualSwap(
      state,
      "2026-08-21",
      target.id,
      candidate.id
    );

    expect(analysis.outcome).toBe("soft-tradeoff");
    expect(analysis.blockers).toEqual([]);
    expect(analysis.tradeoffs.join(" ")).toContain("资质");
  });

  it("does not claim an old warning is improved when the proposed job is not earlier or lighter", () => {
    const { state, target, candidate } = swapFixture();
    candidate.fatiguePoints = target.fatiguePoints + 1;

    const analysis = analyzeManualSwap(
      state,
      "2026-08-21",
      target.id,
      candidate.id
    );

    expect(analysis.improvements.join(" ")).toContain("未发现明确");
    expect(analysis.improvements.join(" ")).not.toContain("预计得到改善");
  });

  it("allows confirmation but explains a wider workload spread as a tradeoff", () => {
    const { state, target, candidate } = swapFixture();
    target.workHours = 6;
    candidate.workHours = 2;
    const earlyFlight = state.flights.find(
      (item) => item.flightNo === "CX937"
    )!;
    state.assignments.push({
      ...candidate,
      id: "candidate-earlier-work",
      flightId: earlyFlight.id,
      flightNo: earlyFlight.flightNo,
      positionRuleId: null,
      position: "既有岗位",
      startTime: earlyFlight.startTime,
      endTime: earlyFlight.endTime,
      workHours: 4,
      fatiguePoints: 4,
    });

    const analysis = analyzeManualSwap(
      state,
      "2026-08-21",
      target.id,
      candidate.id
    );

    expect(analysis.outcome).toBe("soft-tradeoff");
    expect(analysis.blockers).toEqual([]);
    expect(analysis.tradeoffs.join(" ")).toContain("工时或疲劳差");
  });
});
