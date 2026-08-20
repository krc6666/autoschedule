import * as XLSX from "xlsx-js-style";
import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  buildLatePriorityCountsWorkbook,
  parseLatePriorityCountsWorkbook,
} from "../../src/infrastructure/late-priority-counts-excel";

describe("late-priority counts workbook", () => {
  it("round-trips every selected flight and category as final counts", () => {
    const state = createDefaultState();
    state.settings.latePriorityFlightNumbers = ["TR121", "TW616"];
    const staffId = state.positionRules.find(
      (rule) => rule.flightNo === "TR121" && rule.remark === "一号"
    )!.qualifiedStaffIds[0]!;
    state.latePriorityFrequencyAdjustments = [
      {
        month: "2026-08",
        staffId,
        flightNo: "TR121",
        kind: "number-one",
        delta: 3,
      },
    ];

    const workbook = buildLatePriorityCountsWorkbook(state, "2026-08-20");
    const preview = parseLatePriorityCountsWorkbook(
      workbook,
      state,
      "2026-08-20"
    );

    expect(workbook.SheetNames).toEqual(["末班重点岗位次数"]);
    expect(preview.canApply).toBe(true);
    expect(preview.month).toBe("2026-08");
    expect(preview.flightNumbers).toEqual(["TR121", "TW616"]);
    expect(preview.targets).toContainEqual({
      month: "2026-08",
      staffId,
      staffName: state.staff.find((person) => person.id === staffId)!.name,
      flightNo: "TR121",
      category: "一号",
      finalCount: 3,
    });
  });

  it("blocks invalid, duplicate, unknown, and wrong-month rows", () => {
    const state = createDefaultState();
    state.settings.latePriorityFlightNumbers = ["TR121"];
    const staff = state.staff[0]!;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["月份", "人员编号", "人员姓名", "航班号", "岗位类别", "最终次数"],
        ["2026-07", staff.id, staff.name, "TR121", "一号", 1],
        ["2026-08", "unknown", "未知", "TR121", "一号", 1],
        ["2026-08", staff.id, staff.name, "UNKNOWN", "一号", 1],
        ["2026-08", staff.id, staff.name, "TR121", "未知类别", 1],
        ["2026-08", staff.id, staff.name, "TR121", "督导", -1],
        ["2026-08", staff.id, staff.name, "TR121", "申报", 1.5],
        ["2026-08", staff.id, staff.name, "TR121", "送资料", 1],
        ["2026-08", staff.id, staff.name, "TR121", "送资料", 2],
      ]),
      "末班重点岗位次数"
    );

    const preview = parseLatePriorityCountsWorkbook(
      workbook,
      state,
      "2026-08-20"
    );

    expect(preview.canApply).toBe(false);
    expect(preview.errors.join("\n")).toMatch(
      /月份|人员|航班|类别|非负整数|重复/
    );
  });

  it("blocks partial files so missing rows cannot silently clear counts", () => {
    const state = createDefaultState();
    state.settings.latePriorityFlightNumbers = ["TR121"];
    const staff = state.staff[0]!;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["月份", "人员编号", "人员姓名", "航班号", "岗位类别", "最终次数"],
        ["2026-08", staff.id, staff.name, "TR121", "督导", 0],
      ]),
      "末班重点岗位次数"
    );

    const preview = parseLatePriorityCountsWorkbook(
      workbook,
      state,
      "2026-08-20"
    );

    expect(preview.canApply).toBe(false);
    expect(preview.errors.join("\n")).toContain("缺少");
  });
});
