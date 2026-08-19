import { describe, expect, it } from "vitest";

import {
  resetMonthlyLatePriorityFrequencyCounts,
  updateLatePriorityFrequencyAdjustment,
} from "../../src/app/statistics-actions";
import { createDefaultState } from "../../src/defaults";
import { buildMonthlyLatePriorityStatistics } from "../../src/domain/statistics/monthly-late-priority-statistics";

describe("statistics actions", () => {
  it("updates a flight-specific correction without allowing a negative effective count", () => {
    const state = createDefaultState();
    const rule = state.positionRules.find(
      (item) => item.flightNo === "TR121" && item.remark === "一号"
    )!;
    const staffId = rule.qualifiedStaffIds[0]!;

    expect(
      updateLatePriorityFrequencyAdjustment(
        state,
        "2026-08",
        staffId,
        "TR121",
        "number-one",
        -1
      )
    ).toBe(false);
    expect(state.latePriorityFrequencyAdjustments).toEqual([]);

    expect(
      updateLatePriorityFrequencyAdjustment(
        state,
        "2026-08",
        staffId,
        "TR121",
        "number-one",
        1
      )
    ).toBe(true);
    expect(state.latePriorityFrequencyAdjustments).toEqual([
      {
        month: "2026-08",
        staffId,
        flightNo: "TR121",
        kind: "number-one",
        delta: 1,
      },
    ]);
  });

  it("resets selected-month effective counts to zero and keeps other months", () => {
    const state = createDefaultState();
    const rule = state.positionRules.find(
      (item) => item.flightNo === "TR121" && item.remark === "一号"
    )!;
    const staffId = rule.qualifiedStaffIds[0]!;
    state.settings.latePriorityFlightNumbers = ["TR121"];
    state.history = [
      {
        id: "history-tr121-number-one",
        date: "2026-08-10",
        flightNo: "TR121",
        position: rule.name,
        staffId,
        staffName: state.staff.find((person) => person.id === staffId)!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 5,
        remark: rule.remark,
      },
    ];
    state.latePriorityFrequencyAdjustments = [
      {
        month: "2026-08",
        staffId,
        flightNo: "TR121",
        kind: "number-one",
        delta: 2,
      },
      {
        month: "2026-07",
        staffId,
        flightNo: "TR121",
        kind: "number-one",
        delta: 4,
      },
    ];

    expect(resetMonthlyLatePriorityFrequencyCounts(state, "2026-08-18")).toBe(
      true
    );
    expect(state.latePriorityFrequencyAdjustments).toEqual([
      {
        month: "2026-07",
        staffId,
        flightNo: "TR121",
        kind: "number-one",
        delta: 4,
      },
      {
        month: "2026-08",
        staffId,
        flightNo: "TR121",
        kind: "number-one",
        delta: -1,
        resetBaseline: 1,
      },
    ]);
    const category = buildMonthlyLatePriorityStatistics(
      state,
      "2026-08-18"
    ).rows.find((row) => row.staff.id === staffId)?.categories.一号;
    expect(category).toMatchObject({
      effectiveCount: 0,
      manualCorrection: 0,
      visibleDetails: [],
    });
  });
});
