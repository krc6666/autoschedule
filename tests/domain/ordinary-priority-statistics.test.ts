import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { buildOrdinaryPriorityStatistics } from "../../src/domain/statistics/ordinary-priority-statistics";

describe("ordinary priority statistics", () => {
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
