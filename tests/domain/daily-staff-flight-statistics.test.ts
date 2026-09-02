import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { buildDailyStaffFlightStatistics } from "../../src/domain/statistics/daily-staff-flight-statistics";
import type { Assignment, HistoryRecord } from "../../src/model";

function assignment(
  id: string,
  staffId: string,
  staffName: string,
  flightNo: string,
  position: string,
  startTime = "08:00"
): Assignment {
  return {
    id,
    flightId: `flight-${flightNo}`,
    flightNo,
    positionRuleId: null,
    position,
    staffId,
    staffName,
    startTime,
    endTime: "10:00",
    workHours: 2,
    fatiguePoints: 1,
    remark: "",
    manualRemark: "",
    status: "assigned",
  };
}

function historyRecord(
  id: string,
  date: string,
  staffId: string,
  staffName: string,
  flightNo: string,
  historyCoverage?: HistoryRecord["historyCoverage"]
): HistoryRecord {
  return {
    id,
    date,
    flightNo,
    position: "G01",
    staffId,
    staffName,
    startTime: "08:00",
    endTime: "10:00",
    workHours: 2,
    fatiguePoints: 1,
    remark: "",
    ...(historyCoverage ? { historyCoverage } : {}),
  };
}

describe("daily staff flight statistics", () => {
  it("counts each flight once per regular person and excludes administrative support", () => {
    const state = createDefaultState();
    const regular = state.staff.find((person) => person.staffType === "常规")!;
    const administrative = {
      ...regular,
      id: "administrative",
      name: "行政人员",
      staffType: "行政支援" as const,
    };
    state.staff = [regular, administrative];
    state.activeScheduleDate = "2026-09-13";
    state.assignments = [
      assignment("cx-g18", regular.id, regular.name, "CX931", "G18"),
      assignment("cx-g20", regular.id, regular.name, " cx931 ", "G20"),
      assignment("tr-h02", regular.id, regular.name, "TR121", "H02", "12:00"),
      assignment(
        "admin-cx",
        administrative.id,
        administrative.name,
        "CX931",
        "G01"
      ),
    ];

    const result = buildDailyStaffFlightStatistics(state, "2026-09-13");

    expect(result.source).toBe("current");
    expect(result.rows).toEqual([
      {
        staffId: regular.id,
        staffName: regular.name,
        flightNumbers: ["CX931", "TR121"],
      },
    ]);
    expect(result.assignedStaffCount).toBe(1);
    expect(result.unassignedStaffCount).toBe(0);
    expect(result.unassignedStaffNames).toEqual([]);
  });

  it("queries a complete archived workday without mixing in the current schedule", () => {
    const state = createDefaultState();
    const [first, second] = state.staff.filter(
      (person) => person.staffType === "常规"
    );
    state.staff = [first!, second!];
    state.activeScheduleDate = "2026-09-13";
    state.assignments = [
      assignment("current", first!.id, first!.name, "CURRENT1", "G01"),
    ];
    state.history = [
      historyRecord(
        "archived-1",
        "2026-09-11",
        second!.id,
        second!.name,
        "KE166",
        "complete"
      ),
      historyRecord(
        "archived-2",
        "2026-09-11",
        second!.id,
        second!.name,
        "KE166"
      ),
    ];

    const result = buildDailyStaffFlightStatistics(state, "2026-09-11");

    expect(result.source).toBe("history");
    expect(result.rows).toEqual([
      {
        staffId: second!.id,
        staffName: second!.name,
        flightNumbers: ["KE166"],
      },
    ]);
    expect(result.assignedStaffCount).toBe(1);
    expect(result.unassignedStaffCount).toBe(1);
    expect(result.unassignedStaffNames).toEqual([first!.name]);
  });

  it("does not count sick or leave staff as expected working staff", () => {
    const state = createDefaultState();
    const regular = state.staff.find((person) => person.staffType === "常规")!;
    const sick = {
      ...regular,
      id: "sick",
      name: "病假人员",
      status: "病假" as const,
    };
    const leave = {
      ...regular,
      id: "leave",
      name: "休假人员",
      status: "休假" as const,
    };
    state.staff = [regular, sick, leave];
    state.activeScheduleDate = "2026-09-13";
    state.assignments = [
      assignment("regular", regular.id, regular.name, "CX931", "G01"),
      assignment("sick", sick.id, sick.name, "TR121", "G01"),
    ];

    const result = buildDailyStaffFlightStatistics(state, "2026-09-13");

    expect(result.assignedStaffCount).toBe(1);
    expect(result.unassignedStaffCount).toBe(0);
    expect(result.unassignedStaffNames).toEqual([]);
    expect(result.rows.map((row) => row.staffName)).toEqual([regular.name]);
  });

  it("does not present late-priority-only history as a complete daily result", () => {
    const state = createDefaultState();
    const regular = state.staff.find((person) => person.staffType === "常规")!;
    state.staff = [regular];
    state.history = [
      historyRecord(
        "partial",
        "2026-09-05",
        regular.id,
        regular.name,
        "TR121",
        "late-priority-only"
      ),
    ];

    const result = buildDailyStaffFlightStatistics(state, "2026-09-05");

    expect(result.source).toBe("partial-history");
    expect(result.rows).toEqual([]);
    expect(result.assignedStaffCount).toBe(0);
    expect(result.unassignedStaffCount).toBe(0);
    expect(result.unassignedStaffNames).toEqual([]);
  });
});
