import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { Assignment, HistoryRecord } from "../model";
import { buildMonthlyRelaxedShiftStatistics } from "./relaxed-shift-statistics";

function assignment(id: string, flightNo: string, staffId: string, staffName: string, startTime: string, endTime: string): Assignment {
  return {
    id,
    flightId: `flight-${flightNo}`,
    flightNo,
    positionRuleId: id,
    position: "柜台",
    staffId,
    staffName,
    startTime,
    endTime,
    workHours: 2,
    fatiguePoints: 1,
    remark: "",
    manualRemark: "",
    status: "assigned"
  };
}

describe("monthly relaxed shift statistics", () => {
  it("uses a strict cutoff, excludes duty from early departure, and keeps duty and standby in afternoon rest", () => {
    const state = createDefaultState();
    const [duty, standby, afternoon, exactCutoff] = state.staff.filter((person) => person.status === "正常").slice(0, 4);
    state.staff = [duty!, standby!, afternoon!, exactCutoff!];
    state.activeScheduleDate = "2026-07-18";
    state.dutyRosterOverrides = [{
      date: "2026-07-18",
      cxPreflightStaffId: null,
      dutyStaffId: duty!.id,
      standbyStaffIds: [standby!.id, afternoon!.id]
    }];
    state.assignments = [
      assignment("duty-early", "EARLY", duty!.id, duty!.name, "08:00", "10:00"),
      assignment("standby-early", "EARLY", standby!.id, standby!.name, "08:00", "10:00"),
      { ...assignment("standby-guide", "EARLY", standby!.id, standby!.name, "08:00", "10:00"), workHours: 0 },
      assignment("exact-cutoff", "NOON", exactCutoff!.id, exactCutoff!.name, "10:00", "12:00"),
      assignment("afternoon-exact", "NOON", afternoon!.id, afternoon!.name, "10:00", "12:00"),
      assignment("afternoon-flight", "LATE", afternoon!.id, afternoon!.name, "15:00", "17:00")
    ];

    const result = buildMonthlyRelaxedShiftStatistics(state, "2026-07-18");
    const dutyRow = result.rows.find((row) => row.staff.id === duty!.id)!;
    const standbyRow = result.rows.find((row) => row.staff.id === standby!.id)!;
    const afternoonRow = result.rows.find((row) => row.staff.id === afternoon!.id)!;
    const exactCutoffRow = result.rows.find((row) => row.staff.id === exactCutoff!.id)!;

    expect(dutyRow.earlyDepartures).toHaveLength(0);
    expect(dutyRow.afternoonRestDates).toEqual(["2026-07-18"]);
    expect(standbyRow.earlyDepartures).toEqual([{ date: "2026-07-18", flightNo: "EARLY", cutoffTime: "10:00" }]);
    expect(standbyRow.afternoonRestDates).toEqual(["2026-07-18"]);
    expect(afternoonRow.earlyDepartures).toHaveLength(0);
    expect(afternoonRow.afternoonRestDates).toHaveLength(0);
    expect(exactCutoffRow.earlyDepartures).toHaveLength(0);
    expect(exactCutoffRow.afternoonRestDates).toEqual(["2026-07-18"]);
  });

  it("combines archived days with the current schedule and replaces same-day history", () => {
    const state = createDefaultState();
    const person = state.staff.find((item) => item.status === "正常")!;
    person.dutyQualified = false;
    state.staff = [person];
    const archived: HistoryRecord = {
      id: "archived",
      date: "2026-07-16",
      flightNo: "EARLY",
      position: "柜台",
      staffId: person.id,
      staffName: person.name,
      startTime: "08:00",
      endTime: "10:00",
      workHours: 2,
      fatiguePoints: 1,
      remark: ""
    };
    state.history = [archived, { ...archived, id: "stale", date: "2026-07-18", endTime: "09:00" }];
    state.activeScheduleDate = "2026-07-18";
    state.assignments = [assignment("current", "NOON", person.id, person.name, "10:00", "12:00")];

    const row = buildMonthlyRelaxedShiftStatistics(state, "2026-07-18").rows[0]!;
    expect(row.earlyDepartures).toEqual([{ date: "2026-07-16", flightNo: "EARLY", cutoffTime: "10:00" }]);
    expect(row.afternoonRestDates).toEqual(["2026-07-16", "2026-07-18"]);
  });
});
