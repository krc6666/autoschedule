import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { Assignment, HistoryRecord } from "../model";
import { currentScheduleHistory, replaceHistoryForDate } from "./history-actions";

function assignment(id: string, staffId: string, staffName: string): Assignment {
  return {
    id, flightId: "flight-cx937", flightNo: "CX937", positionRuleId: null, position: "临时岗位",
    staffId, staffName, startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 3,
    remark: "配置备注", manualRemark: "临时备注", status: "assigned"
  };
}

describe("history actions", () => {
  it("archives only available workers and adds duty fatigue once", () => {
    const state = createDefaultState();
    const available = state.staff[0]!;
    const unavailable = state.staff[1]!;
    unavailable.status = "病假";
    state.assignments = [assignment("available", available.id, available.name), assignment("unavailable", unavailable.id, unavailable.name)];
    state.dutyRosterOverrides = [{
      date: "2026-07-25", cxPreflightStaffId: null, dutyStaffId: available.id, standbyStaffIds: [null, null]
    }];

    const records = currentScheduleHistory(state, "2026-07-25");
    expect(records.map((record) => record.position)).toEqual(["临时岗位", "值班人员"]);
    expect(records[0]?.remark).toBe("配置备注；临时备注");
    expect(records[1]?.fatiguePoints).toBe(state.settings.dutyFatiguePoints);
  });

  it("replaces only the selected date", () => {
    const state = createDefaultState();
    const prior = { id: "prior", date: "2026-07-23" } as HistoryRecord;
    const replaced = { id: "old", date: "2026-07-25" } as HistoryRecord;
    const incoming = { id: "new", date: "2026-07-25" } as HistoryRecord;
    state.history = [prior, replaced];

    replaceHistoryForDate(state, "2026-07-25", [incoming]);
    expect(state.history.map((record) => record.id)).toEqual(["prior", "new"]);
  });
});
