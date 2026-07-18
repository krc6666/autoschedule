import * as XLSX from "xlsx-js-style";
import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { generateSchedule } from "../domain/scheduler";
import { buildScheduleWorkbook, parseWorkbook } from "./excel";

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
    expect(imported.staff).toEqual([{ id: "9", name: "Test", nightShift: false, status: "正常", remark: "R" }]);
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
});
