import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { buildOrdinaryPriorityStatistics } from "../../src/domain/statistics/ordinary-priority-statistics";

describe("ordinary priority statistics", () => {
  it("counts historical and active assignments for a configured airline and position", () => {
    const state = createDefaultState();
    const staff = state.staff.find(
      (person) => person.staffType === "常规" && person.status === "正常"
    )!;
    const baseRule = state.positionRules[0]!;
    state.staff = [staff];
    state.settings.ordinaryPriorityPositions = [
      { airlineCode: "AK", position: "G08" },
    ];
    state.positionRules = [
      {
        ...baseRule,
        id: "ak151-g08",
        flightNo: "AK151",
        name: "G08",
        category: "常规",
        qualifiedStaffIds: [staff.id],
      },
    ];
    state.history = [
      {
        id: "history-ak151-g08",
        date: "2026-07-16",
        flightNo: "AK151",
        position: "G08",
        staffId: staff.id,
        staffName: staff.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
      },
    ];
    state.activeScheduleDate = "2026-07-18";
    state.assignments = [
      {
        id: "assignment-ak151-g08",
        flightId: "flight-ak151",
        flightNo: "AK151",
        positionRuleId: "ak151-g08",
        position: "G08",
        staffId: staff.id,
        staffName: staff.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];

    const row = buildOrdinaryPriorityStatistics(state, "2026-07-18")[0]!;

    expect(row).toMatchObject({
      qualified: true,
      actualCount: 2,
      effectiveCount: 2,
    });
  });

  it("uses the union of matching position-rule qualifications across flights", () => {
    const state = createDefaultState();
    const staff = state.staff
      .filter(
        (person) => person.staffType === "常规" && person.status === "正常"
      )
      .slice(0, 3);
    const baseRule = state.positionRules[0]!;
    state.staff = staff;
    state.settings.ordinaryPriorityPositions = [
      { airlineCode: "AK", position: "G08" },
    ];
    state.positionRules = [
      {
        ...baseRule,
        id: "ak151-g08",
        flightNo: "AK151",
        name: "G08",
        category: "常规",
        qualifiedStaffIds: [staff[0]!.id],
      },
      {
        ...baseRule,
        id: "ak152-g08",
        flightNo: "AK152",
        name: " G08 ",
        category: "常规",
        qualifiedStaffIds: [staff[1]!.id],
      },
    ];

    const rows = buildOrdinaryPriorityStatistics(state, "2026-07-18");

    expect(rows.map((row) => [row.staff.id, row.qualified])).toEqual([
      [staff[0]!.id, true],
      [staff[1]!.id, true],
      [staff[2]!.id, false],
    ]);
  });
});
