import { describe, expect, it } from "vitest";

import {
  createEmptyWeeklyFlightPlans,
  flightNumbersForDate,
  replaceWeeklyFlightPlan,
} from "../../src/domain/flights/weekly-flight-plan";

describe("weekly flight plan", () => {
  it("returns different presets for target dates on different weekdays", () => {
    let plans = createEmptyWeeklyFlightPlans();
    plans = replaceWeeklyFlightPlan(plans, 1, ["cx937", "KE166"]);
    plans = replaceWeeklyFlightPlan(plans, 2, ["TR121"]);

    expect(flightNumbersForDate(plans, "2026-08-17")).toEqual([
      "CX937",
      "KE166",
    ]);
    expect(flightNumbersForDate(plans, "2026-08-18")).toEqual(["TR121"]);
    expect(flightNumbersForDate(plans, "2026-08-19")).toEqual([]);
  });
});
