import * as XLSX from "xlsx-js-style";
import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { generateSchedule } from "../domain/scheduler";
import { buildConfigWorkbook, buildScheduleWorkbook, parseWorkbook } from "./excel";

describe("workbook boundary", () => {
  it("maps workbook rows into stable domain models", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["编号", "姓名", "是否可上夜班", "状态", "备注"],
      ["9", "Test", "否", "正常", "R"]
    ]), "人员信息");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["航班号", "开始时间", "结束时间", "涉及岗位", "备注"],
      ["AB123", "8:30:00", "10:30", "P1，P2", "R"]
    ]), "航班计划");
    const imported = parseWorkbook(workbook, []);
    expect(imported.staff).toEqual([{ id: "9", name: "Test", staffType: "常规", cxPreflightQualified: false, dutyQualified: true, nightShift: false, status: "正常", remark: "R" }]);
    expect(imported.flights?.[0]).toMatchObject({ flightNo: "AB123", startTime: "08:30", endTime: "10:30", positions: ["P1", "P2"] });
  });

  it("exports both operational and machine-readable schedule views", () => {
    const state = createDefaultState();
    const assignments = generateSchedule(state, "2026-07-18").assignments;
    const workbook = buildScheduleWorkbook(assignments, "2026-07-18");
    expect(workbook.SheetNames).toHaveLength(3);
    expect(workbook.Sheets[workbook.SheetNames[0]!]!["!ref"]).toBeTruthy();
    expect(workbook.Sheets[workbook.SheetNames[1]!]!["!ref"]).toBeTruthy();
  });

  it("imports a flight configuration sheet as reusable templates", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["航班号", "开始时间", "结束时间", "涉及岗位", "备注"],
      ["AB123", "08:30", "10:30", "P1,P2", "到岗"]
    ]), "航班配置");
    const imported = parseWorkbook(workbook, []);
    expect(imported.templates?.[0]).toMatchObject({ flightNo: "AB123", positions: ["P1", "P2"], remark: "到岗" });
  });

  it("round-trips flight templates and passenger thresholds in configuration workbooks", () => {
    const state = createDefaultState();
    state.positionRules[0]!.minPassengers = 30;
    state.positionRules[0]!.category = "分流";
    state.positionRules[0]!.earlyReleaseMinutes = 45;
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.templates).toHaveLength(state.templates.length);
    expect(imported.positionRules?.[0]).toMatchObject({ minPassengers: 30, category: "分流", earlyReleaseMinutes: 45 });
  });

  it("round-trips administrative support position categories", () => {
    const state = createDefaultState();
    state.positionRules[0]!.category = "行政支援";
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.positionRules?.[0]?.category).toBe("行政支援");
  });

  it("keeps regular and administrative rules with the same position name", () => {
    const state = createDefaultState();
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "regular", name: "督导", category: "常规" },
      { ...base, id: "admin", name: "督导", category: "行政支援" }
    ];
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.positionRules?.map((rule) => rule.category)).toEqual(["常规", "行政支援"]);
  });

  it("ignores removed support-category rows", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["航班号", "项目分类", "岗位名称", "备注", "可胜任人员"],
      ["AB123", "支援", "旧支援岗位", "", "手动输入项"]
    ]), "岗位配置");
    expect(parseWorkbook(workbook, []).positionRules).toEqual([]);
  });

  it("round-trips administrative support personnel types", () => {
    const state = createDefaultState();
    state.staff[0]!.staffType = "行政支援";
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.staff?.[0]?.staffType).toBe("行政支援");
  });

  it("round-trips CX preflight personnel qualifications", () => {
    const state = createDefaultState();
    state.staff[0]!.cxPreflightQualified = true;
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.staff?.[0]?.cxPreflightQualified).toBe(true);
  });

  it("round-trips duty personnel qualifications", () => {
    const state = createDefaultState();
    state.staff[0]!.dutyQualified = false;
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.staff?.[0]?.dutyQualified).toBe(false);
  });

  it("exports manually entered names and cell remarks in the horizontal detail", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    const assignments = generateSchedule(state, "2026-07-18").assignments;
    const flight = state.flights[0]!;
    const manualRule = state.positionRules.find((item) => item.flightNo === flight.flightNo && item.name === "超规柜台")!;
    assignments.push({
      id: "manual", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: manualRule.id,
      position: manualRule.name, staffId: null, staffName: "临时人员", startTime: flight.startTime, endTime: flight.endTime,
      workHours: 2, fatiguePoints: manualRule.fatiguePoints, remark: manualRule.remark,
      manualRemark: "09:00-10:00", status: "assigned"
    });
    const workbook = buildScheduleWorkbook(assignments, "2026-07-18");
    const detail = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["保障明细"]!, { header: 1, raw: false, defval: "" }).flat();
    expect(detail).toContain("临时人员\n09:00-10:00");
  });
});
