import { describe, expect, it } from "vitest";

import { createAutoscheduleStore } from "../../src/app/store/autoschedule-store";
import { createDefaultState } from "../../src/defaults";
import { currentScheduleHistory } from "../../src/app/history-actions";
import { buildDailyStaffFlightStatistics } from "../../src/domain/statistics/daily-staff-flight-statistics";
import { getDutyRosterForDate } from "../../src/domain/duty-roster/roster";

describe("group workspace isolation", () => {
  it("uses only the active group's history for statistics and archive reads", () => {
    const initial = createDefaultState();
    initial.settings.dutyFatiguePoints = 0;
    initial.shared.settings.dutyFatiguePoints = 0;
    const a = initial.staff[0]!;
    const b = { ...initial.staff[1]!, id: "b-only", name: "B组人员" };
    initial.groups.A.staff = [a];
    initial.groups.A.history = [
      {
        id: "a-history",
        date: "2026-08-01",
        flightNo: "A-FLIGHT",
        position: "G01",
        staffId: a.id,
        staffName: a.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
      },
    ];
    initial.staff = initial.groups.A.staff;
    initial.history = initial.groups.A.history;
    initial.groups.B.staff = [b];
    initial.groups.B.history = [
      {
        id: "b-history",
        date: "2026-08-01",
        flightNo: "B-FLIGHT",
        position: "G01",
        staffId: b.id,
        staffName: b.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
      },
    ];
    const store = createAutoscheduleStore(initial);

    store.getState().switchGroup("B");
    expect(
      buildDailyStaffFlightStatistics(
        store.getState().model,
        "2026-08-01"
      ).rows.map((row) => row.staffId)
    ).toEqual([b.id]);
    expect(
      currentScheduleHistory(store.getState().model, "2026-08-01")
    ).toEqual([]);

    store.getState().switchGroup("A");
    expect(
      buildDailyStaffFlightStatistics(
        store.getState().model,
        "2026-08-01"
      ).rows.map((row) => row.staffId)
    ).toEqual([a.id]);
  });

  it("keeps duty and standby overrides in the active group", () => {
    const initial = createDefaultState();
    const a = initial.staff[0]!;
    const b = { ...initial.staff[1]!, id: "b-only", name: "B组人员" };
    initial.groups.A.staff = [a];
    initial.groups.A.dutyRosterOverrides = [
      {
        date: "2026-08-01",
        cxPreflightStaffId: null,
        dutyStaffId: a.id,
        standbyStaffIds: [a.id, null],
      },
    ];
    initial.staff = initial.groups.A.staff;
    initial.dutyRosterOverrides = initial.groups.A.dutyRosterOverrides;
    initial.groups.B.staff = [b];
    initial.groups.B.dutyRosterOverrides = [
      {
        date: "2026-08-01",
        cxPreflightStaffId: null,
        dutyStaffId: b.id,
        standbyStaffIds: [b.id, null],
      },
    ];
    const store = createAutoscheduleStore(initial);

    store.getState().switchGroup("B");
    expect(
      getDutyRosterForDate(store.getState().model, "2026-08-01").dutyStaffId
    ).toBe(b.id);
    store.getState().switchGroup("A");
    expect(
      getDutyRosterForDate(store.getState().model, "2026-08-01").dutyStaffId
    ).toBe(a.id);
  });
});
