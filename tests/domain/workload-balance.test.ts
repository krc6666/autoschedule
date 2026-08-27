import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  buildWorkloadTasks,
  evaluateWorkloadBalance,
} from "../../src/domain/reviews/workload-balance";

describe("workload balance task facts", () => {
  it("does not count administrative support placeholders as automatic workload", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const regular = state.positionRules.find(
      (rule) => rule.flightNo === flight.flightNo && rule.category === "常规"
    )!;
    state.settings.adminSupportEnabled = true;
    state.positionRules = [
      regular,
      {
        ...regular,
        id: "administrative-placeholder",
        name: regular.name,
        category: "行政支援",
        qualifiedStaffIds: [],
      },
    ];

    expect(buildWorkloadTasks(state)).toEqual([]);
  });

  it("counts administrative positions by the assigned person's staff type", () => {
    const state = createDefaultState();
    state.settings.dutyFatiguePoints = 0;
    const regular = state.staff[0]!;
    const administrative = state.staff[1]!;
    administrative.staffType = "行政支援";
    const administrativeRule = {
      ...state.positionRules[0]!,
      id: "administrative-position",
      category: "行政支援" as const,
    };
    state.positionRules = [administrativeRule];
    state.assignments = [
      {
        id: "regular-on-administrative-position",
        flightId: state.flights[0]!.id,
        flightNo: state.flights[0]!.flightNo,
        positionRuleId: administrativeRule.id,
        position: administrativeRule.name,
        staffId: regular.id,
        staffName: regular.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 8,
        remark: "行政补位",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "administrative-worker",
        flightId: state.flights[0]!.id,
        flightNo: state.flights[0]!.flightNo,
        positionRuleId: administrativeRule.id,
        position: administrativeRule.name,
        staffId: administrative.id,
        staffName: administrative.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 8,
        remark: "行政补位",
        manualRemark: "",
        status: "assigned",
      },
    ];

    const metrics = evaluateWorkloadBalance(state, "2026-07-25");
    expect(metrics.workHoursDifference).toBe(2);
    expect(metrics.todayFatigueDifference).toBe(8);
  });
});
