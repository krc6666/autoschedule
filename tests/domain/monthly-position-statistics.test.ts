import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { Assignment, HistoryRecord } from "../../src/model";
import { buildMonthlyPositionStatistics } from "../../src/domain/statistics/monthly-position-statistics";

const target = { flightNo: "TR121", position: "H02" } as const;

function historyRecord(
  id: string,
  date: string,
  flightNo: string,
  position: string,
  staffId: string,
  staffName: string
): HistoryRecord {
  return {
    id,
    date,
    flightNo,
    position,
    staffId,
    staffName,
    startTime: "21:55",
    endTime: "23:55",
    workHours: 2,
    fatiguePoints: 10,
    remark: "一号",
  };
}

function assignment(
  id: string,
  ruleId: string,
  staffId: string,
  staffName: string
): Assignment {
  return {
    id,
    flightId: "flight-tr121",
    flightNo: "TR121",
    positionRuleId: ruleId,
    position: "H02",
    staffId,
    staffName,
    startTime: "21:55",
    endTime: "23:55",
    workHours: 2,
    fatiguePoints: 10,
    remark: "一号",
    manualRemark: "",
    status: "assigned",
  };
}

describe("monthly position statistics", () => {
  it("lists only current normal regular qualified staff, including people with zero assignments", () => {
    const state = createDefaultState();
    const rule = state.positionRules.find(
      (item) =>
        item.flightNo === "TR121" &&
        item.name === "H02" &&
        item.category === "常规"
    )!;
    const [firstId, secondId, sickId, adminId] = rule.qualifiedStaffIds.slice(
      0,
      4
    );
    const first = state.staff.find((person) => person.id === firstId)!;
    const second = state.staff.find((person) => person.id === secondId)!;
    const sick = state.staff.find((person) => person.id === sickId)!;
    const admin = state.staff.find((person) => person.id === adminId)!;
    sick.status = "病假";
    admin.staffType = "行政支援";
    rule.qualifiedStaffIds = [first.id, second.id, sick.id, admin.id];
    state.history = [
      historyRecord(
        "first",
        "2026-07-02",
        "TR121",
        "H02",
        first.id,
        first.name
      ),
      historyRecord(
        "duplicate",
        "2026-07-02",
        "TR121",
        "H02",
        first.id,
        first.name
      ),
      historyRecord(
        "other-flight",
        "2026-07-04",
        "OTHER",
        "H02",
        second.id,
        second.name
      ),
      historyRecord(
        "other-position",
        "2026-07-06",
        "TR121",
        "H03",
        second.id,
        second.name
      ),
      historyRecord(
        "other-month",
        "2026-06-30",
        "TR121",
        "H02",
        second.id,
        second.name
      ),
      historyRecord("sick", "2026-07-08", "TR121", "H02", sick.id, sick.name),
      historyRecord(
        "admin",
        "2026-07-10",
        "TR121",
        "H02",
        admin.id,
        admin.name
      ),
    ];

    const result = buildMonthlyPositionStatistics(state, "2026-07-18", target);

    expect(
      result.rows.map((row) => ({
        id: row.staff.id,
        count: row.dates.length,
        dates: row.dates,
      }))
    ).toEqual([
      { id: second.id, count: 0, dates: [] },
      { id: first.id, count: 1, dates: ["2026-07-02"] },
    ]);
    expect(result.range).toEqual({ min: 0, max: 1, difference: 1 });
  });

  it("uses the current final schedule instead of same-day history and reflects a manual staff change", () => {
    const state = createDefaultState();
    const rule = state.positionRules.find(
      (item) =>
        item.flightNo === "TR121" &&
        item.name === "H02" &&
        item.category === "常规"
    )!;
    const [archivedId, currentId] = rule.qualifiedStaffIds.slice(0, 2);
    const archived = state.staff.find((person) => person.id === archivedId)!;
    const current = state.staff.find((person) => person.id === currentId)!;
    rule.qualifiedStaffIds = [archived.id, current.id];
    state.history = [
      historyRecord(
        "old-day",
        "2026-07-16",
        "TR121",
        "H02",
        archived.id,
        archived.name
      ),
      historyRecord(
        "stale-same-day",
        "2026-07-18",
        "TR121",
        "H02",
        archived.id,
        archived.name
      ),
    ];
    state.activeScheduleDate = "2026-07-18";
    state.assignments = [
      assignment("current", rule.id, current.id, current.name),
    ];

    const result = buildMonthlyPositionStatistics(state, "2026-07-18", target);

    expect(
      result.rows.find((row) => row.staff.id === archived.id)?.dates
    ).toEqual(["2026-07-16"]);
    expect(
      result.rows.find((row) => row.staff.id === current.id)?.dates
    ).toEqual(["2026-07-18"]);
  });

  it("reports whether the current regular position configuration has eligible staff", () => {
    const state = createDefaultState();
    state.positionRules = state.positionRules.filter(
      (item) =>
        !(
          item.flightNo === "TR121" &&
          item.name === "H02" &&
          item.category === "常规"
        )
    );
    expect(
      buildMonthlyPositionStatistics(state, "2026-07-18", target)
    ).toMatchObject({ configured: false, rows: [] });

    const emptyState = createDefaultState();
    const rule = emptyState.positionRules.find(
      (item) =>
        item.flightNo === "TR121" &&
        item.name === "H02" &&
        item.category === "常规"
    )!;
    rule.qualifiedStaffIds = [];
    expect(
      buildMonthlyPositionStatistics(emptyState, "2026-07-18", target)
    ).toMatchObject({ configured: true, rows: [] });
  });
});
