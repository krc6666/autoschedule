import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { getMonthlyDutyRoster, updateDutyRosterSlot } from "../domain/duty-roster";
import type { HistoryRecord } from "../model";
import { renderStatistics } from "./statistics-view";

describe("statistics view", () => {
  it("contains monthly roster, relaxed shifts, and TR121/H02 counts with roster actions intact", () => {
    const state = createDefaultState();
    const rule = state.positionRules.find((item) => item.flightNo === "TR121" && item.name === "H02" && item.category === "常规")!;
    const person = state.staff.find((item) => item.id === rule.qualifiedStaffIds[0])!;
    const record: HistoryRecord = {
      id: "tr-h02",
      date: "2026-07-16",
      flightNo: "TR121",
      position: "H02",
      staffId: person.id,
      staffName: person.name,
      startTime: "21:55",
      endTime: "23:55",
      workHours: 2,
      fatiguePoints: 10,
      remark: "一号"
    };
    state.history = [record];

    const html = renderStatistics(state, "2026-07-18");

    expect(html).toContain("月度轮值明细");
    expect(html).toContain("月度轻松班次统计");
    expect(html).toContain("TR121 / H02 月度承担次数");
    expect(html).toContain('data-action="download-duty-roster-template"');
    expect(html).toContain('data-action="import-duty-roster"');
    expect(html).toContain('data-entity="duty-roster"');
    expect(html).toContain('data-action="reset-duty-roster"');
    expect(html).toContain(person.name);
    expect(html).toContain("07-16");
    expect(html).toContain("最高 / 最低");
    expect(html).toContain("差值");
  });

  it("shows explicit empty states for missing configuration and missing qualified staff", () => {
    const state = createDefaultState();
    state.positionRules = state.positionRules.filter((item) => !(item.flightNo === "TR121" && item.name === "H02" && item.category === "常规"));
    expect(renderStatistics(state, "2026-07-18")).toContain("尚未配置 TR121 / H02 常规岗位");

    const emptyState = createDefaultState();
    const rule = emptyState.positionRules.find((item) => item.flightNo === "TR121" && item.name === "H02" && item.category === "常规")!;
    rule.qualifiedStaffIds = [];
    expect(renderStatistics(emptyState, "2026-07-18")).toContain("尚未配置正常常规资质人员");
  });

  it("keeps the monthly duty rebalancing action after manual changes", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => person.status === "正常");
    state.staff.forEach((person) => { person.dutyQualified = true; });
    const rows = getMonthlyDutyRoster(state, "2026-08-01");
    const repeated = state.staff.find((person) => rows.some((row) => row.dutyStaffId === person.id))!;
    const targetRow = rows.find((row) => row.dutyStaffId !== repeated.id
      && row.cxPreflightStaffId !== repeated.id
      && !row.standbyStaffIds.includes(repeated.id))!;
    expect(updateDutyRosterSlot(state, targetRow.date, "duty", repeated.id)).toBeNull();

    const html = renderStatistics(state, "2026-08-01");

    expect(html).toContain("值班均衡未完成");
    expect(html).toContain('data-action="rebalance-duty-roster-month"');
  });
});
