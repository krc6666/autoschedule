import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  buildMonthlyLatePriorityStatistics,
  latePriorityStatisticsFlightNumbers,
} from "../../src/domain/statistics/monthly-late-priority-statistics";
import type { AppState, HistoryRecord, PositionRule } from "../../src/model";

const DATE = "2026-08-18";

function addLateFlight(
  state: AppState,
  flightNo: string,
  staffId: string
): void {
  state.flights.push({
    id: `flight-${flightNo.toLowerCase()}`,
    flightNo,
    startTime: "22:00",
    endTime: "23:55",
    bookedPassengers: 0,
    positions: ["T01", "T02", "T03", "T04"],
    remark: "",
  });
  const definitions = [
    ["T01", "一号"],
    ["T02", "申报"],
    ["T03", "送资料"],
    ["督导", ""],
  ] as const;
  state.positionRules.push(
    ...definitions.map(([name, remark], index): PositionRule => ({
      id: `position-${flightNo.toLowerCase()}-${index}`,
      flightNo,
      name,
      category: "常规",
      remark,
      qualifiedStaffIds: [staffId],
      manual: false,
      fatiguePoints: 5,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    }))
  );
}

function history(
  id: string,
  flightNo: string,
  position: string,
  remark: string,
  staffId: string,
  date = "2026-08-10",
  endTime = "23:55"
): HistoryRecord {
  return {
    id,
    date,
    flightNo,
    position,
    staffId,
    staffName: "测试人员",
    startTime: "22:00",
    endTime,
    workHours: 2,
    fatiguePoints: 5,
    remark,
  };
}

describe("monthly late priority statistics", () => {
  it("lists selectable late flights and keeps each flight separate", () => {
    const state = createDefaultState();
    const trRule = state.positionRules.find(
      (rule) => rule.flightNo === "TR121" && rule.name === "H02"
    )!;
    const trStaffId = trRule.qualifiedStaffIds[0]!;
    const trZeroStaffId = trRule.qualifiedStaffIds[1]!;
    const sickStaffId = trRule.qualifiedStaffIds[2]!;
    const adminStaffId = trRule.qualifiedStaffIds[3]!;
    state.staff.find((person) => person.id === sickStaffId)!.status = "病假";
    state.staff.find((person) => person.id === adminStaffId)!.staffType =
      "行政支援";
    trRule.qualifiedStaffIds = [
      trStaffId,
      trZeroStaffId,
      sickStaffId,
      adminStaffId,
    ];
    const twStaffId = state.staff.find(
      (person) => !trRule.qualifiedStaffIds.includes(person.id)
    )!.id;
    addLateFlight(state, "TW616", twStaffId);
    state.history = [
      history("tr-one", "TR121", "H02", "一号", trStaffId),
      history("tw-one", "TW616", "T01", "一号", twStaffId),
    ];

    expect(latePriorityStatisticsFlightNumbers(state)).toEqual([
      "TR121",
      "TW616",
    ]);

    const tr = buildMonthlyLatePriorityStatistics(state, DATE, "TR121", "一号");
    const tw = buildMonthlyLatePriorityStatistics(state, DATE, "TW616", "一号");

    expect(tr.rows.map((row) => [row.staff.id, row.dates])).toEqual([
      [trZeroStaffId, []],
      [trStaffId, ["2026-08-10"]],
    ]);
    expect(tw.rows.map((row) => [row.staff.id, row.dates])).toEqual([
      [twStaffId, ["2026-08-10"]],
    ]);
  });

  it("uses the four labels and only counts qualified normal regular staff", () => {
    const state = createDefaultState();
    const rules = {
      一号: state.positionRules.find(
        (rule) => rule.flightNo === "TR121" && rule.remark === "一号"
      )!,
      申报: state.positionRules.find(
        (rule) => rule.flightNo === "TR121" && rule.remark === "申报"
      )!,
      送资料: state.positionRules.find(
        (rule) => rule.flightNo === "TR121" && rule.remark === "送资料"
      )!,
      督导: state.positionRules.find(
        (rule) => rule.flightNo === "TR121" && rule.name === "督导"
      )!,
    };
    const qualifiedId = rules.一号.qualifiedStaffIds[0]!;
    const unqualifiedId = state.staff.find(
      (person) => person.id !== qualifiedId
    )!.id;
    Object.values(rules).forEach((rule) => {
      rule.qualifiedStaffIds = [qualifiedId];
    });
    state.history = [
      history("one", "TR121", rules.一号.name, rules.一号.remark, qualifiedId),
      history(
        "declaration",
        "TR121",
        rules.申报.name,
        rules.申报.remark,
        qualifiedId
      ),
      history(
        "delivery",
        "TR121",
        rules.送资料.name,
        rules.送资料.remark,
        qualifiedId
      ),
      history(
        "supervisor",
        "TR121",
        rules.督导.name,
        rules.督导.remark,
        qualifiedId
      ),
      history(
        "unqualified",
        "TR121",
        rules.一号.name,
        rules.一号.remark,
        unqualifiedId
      ),
      history(
        "boundary",
        "TR121",
        rules.一号.name,
        rules.一号.remark,
        qualifiedId,
        "2026-08-12",
        "23:00"
      ),
    ];

    for (const category of ["督导", "一号", "申报", "送资料"] as const) {
      const statistics = buildMonthlyLatePriorityStatistics(
        state,
        DATE,
        "TR121",
        category
      );
      expect(statistics.rows).toHaveLength(1);
      expect(statistics.rows[0]?.staff.id).toBe(qualifiedId);
      expect(statistics.rows[0]?.dates).toEqual(["2026-08-10"]);
    }
  });

  it("lets a combined declaration and delivery role enter both categories", () => {
    const state = createDefaultState();
    const combinedRule = state.positionRules.find(
      (rule) => rule.flightNo === "TR121" && rule.name === "H04"
    )!;
    combinedRule.remark = "申报/送资料";
    const staffId = combinedRule.qualifiedStaffIds[0]!;
    combinedRule.qualifiedStaffIds = [staffId];
    state.activeScheduleDate = DATE;
    state.assignments = [
      {
        id: "current-combined",
        flightId: state.flights.find((flight) => flight.flightNo === "TR121")!
          .id,
        flightNo: "TR121",
        positionRuleId: combinedRule.id,
        position: combinedRule.name,
        staffId,
        staffName: "测试人员",
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 5,
        remark: combinedRule.remark,
        manualRemark: "",
        status: "assigned",
      },
    ];

    for (const category of ["申报", "送资料"] as const) {
      expect(
        buildMonthlyLatePriorityStatistics(
          state,
          DATE,
          "TR121",
          category
        ).rows.find((row) => row.staff.id === staffId)?.dates
      ).toEqual([DATE]);
    }
  });

  it("uses the current final schedule instead of same-day history", () => {
    const state = createDefaultState();
    const rule = state.positionRules.find(
      (item) => item.flightNo === "TR121" && item.remark === "一号"
    )!;
    const archivedStaffId = rule.qualifiedStaffIds[0]!;
    const currentStaffId = rule.qualifiedStaffIds[1]!;
    rule.qualifiedStaffIds = [archivedStaffId, currentStaffId];
    state.history = [
      history(
        "old-day",
        "TR121",
        rule.name,
        rule.remark,
        archivedStaffId,
        "2026-08-16"
      ),
      history(
        "stale-same-day",
        "TR121",
        rule.name,
        rule.remark,
        archivedStaffId,
        DATE
      ),
    ];
    state.activeScheduleDate = DATE;
    state.assignments = [
      {
        id: "current-one",
        flightId: state.flights.find((flight) => flight.flightNo === "TR121")!
          .id,
        flightNo: "TR121",
        positionRuleId: rule.id,
        position: rule.name,
        staffId: currentStaffId,
        staffName: "当前人员",
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 5,
        remark: rule.remark,
        manualRemark: "",
        status: "assigned",
      },
    ];

    const statistics = buildMonthlyLatePriorityStatistics(
      state,
      DATE,
      "TR121",
      "一号"
    );
    expect(
      statistics.rows.find((row) => row.staff.id === archivedStaffId)?.dates
    ).toEqual(["2026-08-16"]);
    expect(
      statistics.rows.find((row) => row.staff.id === currentStaffId)?.dates
    ).toEqual([DATE]);
  });

  it("keeps supervisor-qualified rows visible but excludes their allowed relief from the declaration spread", () => {
    const state = createDefaultState();
    const supervisorRule = state.positionRules.find(
      (rule) => rule.flightNo === "TR121" && rule.name === "督导"
    )!;
    const declarationRule = state.positionRules.find(
      (rule) => rule.flightNo === "TR121" && rule.remark === "申报"
    )!;
    const supervisorId = supervisorRule.qualifiedStaffIds[0]!;
    const ordinaryIds = state.staff
      .filter(
        (person) =>
          person.status === "正常" &&
          person.staffType === "常规" &&
          person.id !== supervisorId
      )
      .slice(0, 2)
      .map((person) => person.id);
    supervisorRule.qualifiedStaffIds = [supervisorId];
    declarationRule.qualifiedStaffIds = [supervisorId, ...ordinaryIds];
    state.history = [
      history(
        "ordinary-once",
        "TR121",
        declarationRule.name,
        declarationRule.remark,
        ordinaryIds[0]!,
        "2026-08-10"
      ),
      history(
        "ordinary-twice-1",
        "TR121",
        declarationRule.name,
        declarationRule.remark,
        ordinaryIds[1]!,
        "2026-08-10"
      ),
      history(
        "ordinary-twice-2",
        "TR121",
        declarationRule.name,
        declarationRule.remark,
        ordinaryIds[1]!,
        "2026-08-12"
      ),
    ];

    const statistics = buildMonthlyLatePriorityStatistics(
      state,
      DATE,
      "TR121",
      "申报"
    );

    expect(statistics.range).toEqual({ min: 1, max: 2, difference: 1 });
    expect(
      statistics.rows.find((row) => row.staff.id === supervisorId)
        ?.supervisorQualified
    ).toBe(true);
  });
});
