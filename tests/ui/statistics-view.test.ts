// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  getMonthlyDutyRoster,
  updateDutyRosterSlot,
} from "../../src/domain/duty-roster/roster";
import type { HistoryRecord } from "../../src/model";
import "../../src/ui/components/statistics-page";
import { mountElement } from "./lit-test-helpers";

describe("statistics page", () => {
  it("keeps monthly roster, relaxed shifts, position counts, and roster actions", async () => {
    const state = createDefaultState();
    const rule = state.positionRules.find(
      (item) =>
        item.flightNo === "TR121" &&
        item.name === "H02" &&
        item.category === "常规"
    )!;
    const person = state.staff.find(
      (item) => item.id === rule.qualifiedStaffIds[0]
    )!;
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
      remark: "一号",
    };
    state.history = [record];
    state.settings.latePriorityFlightNumbers = ["TR121"];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-statistics-page", { model: state, date: "2026-07-18" });
    const text = element.textContent ?? "";

    expect(text).toContain("月度轮值明细");
    expect(text).toContain("月度轻松班次统计");
    expect(text).toContain("末班重点岗位统计");
    expect(text).toContain("当前统计航班：TR121");
    expect(text).toContain("四类合计");
    expect(text).toContain("督导");
    expect(text).toContain("一号");
    expect(text).toContain("申报");
    expect(text).toContain("送资料");
    expect(text).toContain("允许差值 1");
    expect(text).toContain("允许差值 2");
    expect(text).not.toContain("TR121 / H02 月度承担次数");
    expect(text).toContain(person.name);
    expect(text).toContain("07-16");
    expect(
      element.querySelector(".late-priority-summary-table")
    ).not.toBeNull();
    expect(element.querySelector(".late-priority-count-detail")).not.toBeNull();
    expect(text).toContain("下载值班备勤模板");
    expect(text).toContain("导入值班备勤表");
    expect(
      element.querySelector('select[aria-label*="值班人员"]')
    ).not.toBeNull();
  });

  it("shows the persisted duty-roster person when it is not the first option", async () => {
    const state = createDefaultState();
    const dutyStaff = state.staff.filter(
      (person) =>
        person.status === "正常" &&
        person.staffType === "常规" &&
        person.dutyQualified
    );
    const selected = dutyStaff[1]!;
    const rosterDate = getMonthlyDutyRoster(state, "2026-07-18")[0]!.date;
    state.dutyRosterOverrides = [
      {
        date: rosterDate,
        cxPreflightStaffId: null,
        dutyStaffId: selected.id,
        standbyStaffIds: [null, null],
      },
    ];

    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-statistics-page", { model: state, date: "2026-07-18" });

    expect(
      element.querySelector<HTMLSelectElement>(
        `select[aria-label="${rosterDate} 值班人员"]`
      )?.value
    ).toBe(selected.id);
  });

  it("summarizes all selected late-priority flights in one table", async () => {
    const state = createDefaultState();
    const staffId = state.staff[0]!.id;
    state.flights.push({
      id: "flight-tw616",
      flightNo: "TW616",
      startTime: "22:05",
      endTime: "23:55",
      bookedPassengers: 0,
      positions: ["T01", "T02", "T03", "督导"],
      remark: "",
    });
    state.positionRules.push(
      ...[
        ["T01", "一号"],
        ["T02", "申报"],
        ["T03", "送资料"],
        ["督导", ""],
      ].map(([name, remark], index) => ({
        id: `position-tw616-${index}`,
        flightNo: "TW616",
        name: name!,
        category: "常规" as const,
        remark: remark!,
        qualifiedStaffIds: [staffId],
        manual: false,
        fatiguePoints: 5,
        minPassengers: 0,
        earlyReleaseMinutes: 0,
      }))
    );
    state.settings.latePriorityFlightNumbers = ["TR121", "TW616"];
    state.history = [
      {
        id: "tw-delivery",
        date: "2026-07-16",
        flightNo: "TW616",
        position: "T03",
        staffId,
        staffName: state.staff[0]!.name,
        startTime: "22:05",
        endTime: "23:55",
        workHours: 1.83,
        fatiguePoints: 5,
        remark: "送资料",
      },
    ];

    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-statistics-page", { model: state, date: "2026-07-18" });
    const workspace = element.querySelector(
      '[data-late-priority-flights="TR121,TW616"]'
    );
    const workspaceText = (workspace?.textContent ?? "").replace(/\s+/g, " ");

    expect(workspace).not.toBeNull();
    expect(
      element.querySelector('[aria-label="选择末班重点岗位统计航班"]')
    ).toBeNull();
    expect(
      workspace?.querySelectorAll(".late-priority-summary-table")
    ).toHaveLength(1);
    expect(workspaceText).toContain("当前统计航班：TR121、TW616");
    expect(workspaceText).toContain("07-16");
    expect(workspaceText).toContain("TW616 / T03 / 送资料");
  });

  it("shows explicit missing configuration and monthly rebalancing states", async () => {
    const missing = createDefaultState();
    missing.settings.latePriorityFlightNumbers = [];
    const missingElement = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-statistics-page", { model: missing, date: "2026-07-18" });
    expect(missingElement.textContent).toContain("尚未选择统计航班");
    expect(
      missingElement.querySelector(".late-priority-summary-table")
    ).toBeNull();

    const adjusted = createDefaultState();
    adjusted.staff = adjusted.staff.filter(
      (person) => person.status === "正常"
    );
    adjusted.staff.forEach((person) => {
      person.dutyQualified = true;
    });
    const rows = getMonthlyDutyRoster(adjusted, "2026-08-01");
    const repeated = adjusted.staff.find((person) =>
      rows.some((row) => row.dutyStaffId === person.id)
    )!;
    const target = rows.find(
      (row) =>
        row.dutyStaffId !== repeated.id &&
        row.cxPreflightStaffId !== repeated.id &&
        !row.standbyStaffIds.includes(repeated.id)
    )!;
    expect(
      updateDutyRosterSlot(adjusted, target.date, "duty", repeated.id)
    ).toBeNull();
    const adjustedElement = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-statistics-page", { model: adjusted, date: "2026-08-01" });
    expect(adjustedElement.textContent).toContain("值班均衡未完成");
    expect(adjustedElement.textContent).toContain("重新均衡本月");
  });
});
