import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { AppState, Assignment } from "../model";
import { reviewLateShiftCutoff } from "./late-shift-cutoff-review";

function cutoffState(): AppState {
  const state = createDefaultState();
  const [protectedWorker, alternate] = state.staff
    .filter((person) => person.status === "正常")
    .slice(0, 2);
  state.staff = [protectedWorker!, alternate!];
  state.staff.forEach((person) => {
    person.dutyQualified = false;
  });
  state.flights = [
    {
      id: "early",
      flightNo: "EARLY100",
      startTime: "08:00",
      endTime: "10:00",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
    {
      id: "afternoon",
      flightNo: "DAY200",
      startTime: "13:00",
      endTime: "15:00",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
    {
      id: "evening",
      flightNo: "NIGHT300",
      startTime: "20:00",
      endTime: "22:00",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
  ];
  const base = state.positionRules[0]!;
  const qualifiedStaffIds = state.staff.map((person) => person.id);
  state.positionRules = state.flights.map((flight, index) => ({
    ...base,
    id: `rule-${index}`,
    flightNo: flight.flightNo,
    name: `P${index}`,
    category: "常规" as const,
    remark: "",
    fatiguePoints: 1,
    qualifiedStaffIds,
  }));
  state.settings.lateShiftRecoveryPositionRules.find(
    (rule) => rule.keyword === "一号"
  )!.nextWorkdayCutoffTime = "12:00";
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.positionRotationEnabled = false;
  state.history = [
    {
      id: "protected-late",
      date: "2026-08-21",
      flightNo: "TR121",
      position: "H02",
      staffId: protectedWorker!.id,
      staffName: protectedWorker!.name,
      startTime: "21:55",
      endTime: "23:55",
      workHours: 2,
      fatiguePoints: 1,
      remark: "一号",
    },
  ];
  return state;
}

function assignment(
  state: AppState,
  id: string,
  flightIndex: number,
  staffIndex: number,
  fatiguePoints = 1
): Assignment {
  const flight = state.flights[flightIndex]!;
  const rule = state.positionRules[flightIndex]!;
  const staff = state.staff[staffIndex]!;
  return {
    id,
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId: staff.id,
    staffName: staff.name,
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: 2,
    fatiguePoints,
    remark: rule.remark,
    manualRemark: "",
    status: "assigned",
  };
}

describe("late-shift next-workday cutoff review", () => {
  it("directly reassigns a late flight when that makes the protected worker leave earlier without worsening load spread", () => {
    const state = cutoffState();
    const assignments = [
      assignment(state, "early", 0, 0),
      assignment(state, "afternoon", 1, 1),
      assignment(state, "evening", 2, 0),
    ];

    expect(
      reviewLateShiftCutoff(state, assignments, "2026-08-23", new Set())
    ).toEqual([]);
    expect(assignments.find((item) => item.id === "evening")?.staffId).toBe(
      state.staff[1]!.id
    );
    expect(
      assignments.find((item) => item.id === "evening")?.decisionTrace
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "late-shift-cutoff",
          outcome: "selected",
        }),
      ])
    );
  });

  it("keeps the complete schedule and reports a fallback when every reassignment would widen fatigue spread", () => {
    const state = cutoffState();
    const assignments = [
      assignment(state, "early", 0, 0, 0),
      assignment(state, "afternoon", 1, 1, 10),
      assignment(state, "evening", 2, 0, 10),
    ];

    const warnings = reviewLateShiftCutoff(
      state,
      assignments,
      "2026-08-23",
      new Set()
    );

    expect(assignments.find((item) => item.id === "evening")?.staffId).toBe(
      state.staff[0]!.id
    );
    expect(warnings.join(" ")).toContain("扩大工时或疲劳差");
    expect(warnings.join(" ")).toContain("为保证岗位完整性");
  });
});
