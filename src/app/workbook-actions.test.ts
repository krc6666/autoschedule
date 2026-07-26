import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { HistoryRecord } from "../model";
import { applyWorkbookImport } from "./workbook-actions";

describe("workbook actions", () => {
  it("applies a mixed import, clears the active schedule, and reports recognized data", () => {
    const state = createDefaultState();
    const flight = { ...state.flights[0]!, id: "imported-flight", flightNo: "NEW100" };
    const person = { ...state.staff[0]!, id: "imported-staff", name: "导入人员" };
    state.assignments = [{
      id: "assignment", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: null, position: "临时岗位",
      staffId: null, staffName: "", startTime: "08:00", endTime: "09:00", workHours: 0, fatiguePoints: 0,
      remark: "", manualRemark: "", status: "manual"
    }];
    state.activeScheduleDate = "2026-07-25";

    const result = applyWorkbookImport(state, { staff: [person], flights: [flight], warnings: [] }, "all");
    expect(result).toMatchObject({ changedConfig: true });
    expect(result.recognized).toContain("1 人");
    expect(state.staff).toEqual([person]);
    expect(state.flights).toEqual([flight]);
    expect(state.assignments).toEqual([]);
    expect(state.activeScheduleDate).toBeNull();
  });

  it("keeps configuration untouched in history-only mode and replaces duplicate history keys", () => {
    const state = createDefaultState();
    const originalStaff = structuredClone(state.staff);
    const history = {
      id: "incoming", date: "2026-07-23", flightNo: "CX937", position: "G20", staffId: "2", staffName: "华嘉慧",
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 4, remark: ""
    } satisfies HistoryRecord;
    state.history = [{ ...history, id: "old" }];

    applyWorkbookImport(state, { staff: [], history: [history], warnings: [] }, "history");
    expect(state.staff).toEqual(originalStaff);
    expect(state.history).toEqual([history]);
  });
});
