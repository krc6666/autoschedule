import { describe, expect, it } from "vitest";

import { updateLatePriorityFrequencyAdjustment } from "../../src/app/statistics-actions";
import { createDefaultState } from "../../src/defaults";

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
});
