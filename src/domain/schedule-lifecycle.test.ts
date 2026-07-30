import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import {
  clearActiveSchedule,
  installGeneratedSchedule,
  markActiveScheduleStale,
} from "./schedule-lifecycle";

describe("schedule lifecycle", () => {
  it("offers one explicit state transition for stale, cleared, and generated schedules", () => {
    const state = createDefaultState();
    const assignment = {
      id: "assignment",
      flightId: "flight",
      flightNo: "F1",
      positionRuleId: null,
      position: "岗位",
      staffId: null,
      staffName: "",
      startTime: "08:00",
      endTime: "10:00",
      workHours: 2,
      fatiguePoints: 1,
      remark: "",
      manualRemark: "",
      status: "unfilled" as const,
    };
    installGeneratedSchedule(state, "2026-07-30", {
      assignments: [assignment],
      unfilledCount: 1,
      warnings: [],
    });
    expect(state).toMatchObject({
      activeScheduleDate: "2026-07-30",
      schedulePolicyStale: false,
    });
    expect(markActiveScheduleStale(state)).toBe(true);
    clearActiveSchedule(state);
    expect(state).toMatchObject({
      assignments: [],
      activeScheduleDate: null,
      schedulePolicyStale: false,
    });
  });
});
