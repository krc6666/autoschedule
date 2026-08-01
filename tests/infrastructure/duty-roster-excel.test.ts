import * as XLSX from "xlsx-js-style";
import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  buildDutyRosterTemplateWorkbook,
  parseDutyRosterWorkbook,
} from "../../src/infrastructure/duty-roster-excel";

describe("duty roster workbook boundary", () => {
  it("parses 24 as duty and maps rest-day standby to the previous workday", () => {
    const state = createDefaultState();
    const [first, second, third, fourth] = state.staff;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["国际值机7月排班、值班、备勤表"],
        ["序号", "姓名", "周三", "周四", "周五"],
        ["", "", "0701", "0702", "0703"],
        [1, first!.name, "24", "", ""],
        [2, second!.name, "", "备勤", ""],
        [3, third!.name, "", "备勤", ""],
        [4, fourth!.name, "休", "休", "24"],
      ]),
      "值班备勤表"
    );

    const preview = parseDutyRosterWorkbook(
      workbook,
      state.staff,
      "2026-07-01"
    );

    expect(preview.errors).toEqual([]);
    expect(preview.recognizedAssignments).toBe(4);
    expect(preview.rows.find((row) => row.date === "2026-07-01")).toMatchObject(
      {
        dutyStaffId: first!.id,
        standbyDate: "2026-07-02",
        standbyStaffIds: [second!.id, third!.id],
      }
    );
    expect(
      preview.rows.find((row) => row.date === "2026-07-03")?.dutyStaffId
    ).toBe(fourth!.id);
  });

  it("blocks unknown names, ineligible duty staff, and duplicate daily assignments", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    person.dutyQualified = false;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["姓名", "0701", "0702"],
        [person.name, "24", "备勤"],
        ["不存在的人", "24", "备勤"],
      ]),
      "值班备勤"
    );

    const preview = parseDutyRosterWorkbook(
      workbook,
      state.staff,
      "2026-07-01"
    );

    expect(preview.errors.join("；")).toContain("不具备值班资质");
    expect(preview.errors.join("；")).toContain("未匹配人员");
    expect(preview.canApply).toBe(false);
  });

  it("exports a screenshot-like monthly template with workdays and rest days", () => {
    const state = createDefaultState();
    const workbook = buildDutyRosterTemplateWorkbook(state, "2026-07-01");
    const data = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets["值班备勤表"]!,
      { header: 1, raw: false, defval: "" }
    );

    expect(data[0]?.[0]).toContain("2026年7月排班、值班、备勤表");
    expect(data[2]).toContain("0701");
    expect(data[2]).toContain("0702");
    expect(data.flat()).toContain("24");
    expect(data.flat()).toContain("备勤");
    expect(data.flat()).toContain("休");
    expect(workbook.Sheets["值班备勤表"]?.["!merges"]).toHaveLength(3);
    const cells = Object.values(workbook.Sheets["值班备勤表"]!).filter(
      (cell): cell is XLSX.CellObject =>
        Boolean(cell) && typeof cell === "object" && "v" in cell
    );
    expect(cells.find((cell) => cell.v === "24")?.s).toMatchObject({
      font: { color: { rgb: "C00000" } },
    });
    expect(cells.find((cell) => cell.v === "备勤")?.s).toMatchObject({
      fill: { fgColor: { rgb: "F8CBAD" } },
    });
  });

  it("maps a first-of-month standby back to the previous workday without covering its duty", () => {
    const state = createDefaultState();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["姓名", "0801", "0802"],
        [state.staff[0]!.name, "备勤", ""],
        [state.staff[1]!.name, "备勤", ""],
        [state.staff[2]!.name, "", "24"],
      ]),
      "值班备勤表"
    );

    const preview = parseDutyRosterWorkbook(
      workbook,
      state.staff,
      "2026-08-02"
    );
    const previousMonth = preview.rows.find((row) => row.date === "2026-07-31");

    expect(previousMonth).toMatchObject({
      standbyDate: "2026-08-01",
      dutyIncluded: false,
      standbyIncluded: true,
    });
    expect(previousMonth?.standbyStaffIds).toEqual([
      state.staff[0]!.id,
      state.staff[1]!.id,
    ]);
  });
});
