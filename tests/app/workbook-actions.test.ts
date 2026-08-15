import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { HistoryRecord } from "../../src/model";
import type { DutyRosterImportPreview } from "../../src/infrastructure/duty-roster-excel";
import {
  applyDutyRosterImport,
  applyWorkbookImport,
  validateDutyRosterImport,
} from "../../src/app/workbook-actions";
import { replaceWeeklyFlightPlan } from "../../src/domain/flights/weekly-flight-plan";

describe("workbook actions", () => {
  it("replaces an imported weekly plan, filters missing templates, and preserves it when omitted", () => {
    const state = createDefaultState();
    state.weeklyFlightPlans = replaceWeeklyFlightPlan(
      state.weeklyFlightPlans,
      1,
      [state.templates[0]!.flightNo]
    );
    const preserved = structuredClone(state.weeklyFlightPlans);

    applyWorkbookImport(state, { warnings: [] }, "config");
    expect(state.weeklyFlightPlans).toEqual(preserved);

    const importedPlan = replaceWeeklyFlightPlan(
      createDefaultState().weeklyFlightPlans,
      2,
      [state.templates[1]!.flightNo, "MISSING100"]
    );
    const result = applyWorkbookImport(
      state,
      { weeklyFlightPlans: importedPlan, warnings: [] },
      "config"
    );

    expect(
      state.weeklyFlightPlans.find((entry) => entry.weekday === 1)?.flightNos
    ).toEqual([]);
    expect(
      state.weeklyFlightPlans.find((entry) => entry.weekday === 2)?.flightNos
    ).toEqual([state.templates[1]!.flightNo]);
    expect(result).toEqual({
      changedConfig: true,
      recognized: "每周航班计划",
    });
  });

  it("applies a mixed import, clears the active schedule, and reports recognized data", () => {
    const state = createDefaultState();
    const flight = {
      ...state.flights[0]!,
      id: "imported-flight",
      flightNo: "NEW100",
    };
    const person = {
      ...state.staff[0]!,
      id: "imported-staff",
      name: "导入人员",
    };
    state.assignments = [
      {
        id: "assignment",
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: null,
        position: "临时岗位",
        staffId: null,
        staffName: "",
        startTime: "08:00",
        endTime: "09:00",
        workHours: 0,
        fatiguePoints: 0,
        remark: "",
        manualRemark: "",
        status: "manual",
      },
    ];
    state.activeScheduleDate = "2026-07-25";
    state.schedulePolicyStale = true;

    const result = applyWorkbookImport(
      state,
      { staff: [person], flights: [flight], warnings: [] },
      "all"
    );
    expect(result).toMatchObject({ changedConfig: true });
    expect(result.recognized).toContain("1 人");
    expect(state.staff).toEqual([person]);
    expect(state.flights).toEqual([flight]);
    expect(state.assignments).toEqual([]);
    expect(state.activeScheduleDate).toBeNull();
    expect(state.schedulePolicyStale).toBe(false);
  });

  it("keeps configuration untouched in history-only mode and replaces duplicate history keys", () => {
    const state = createDefaultState();
    const originalStaff = structuredClone(state.staff);
    const history = {
      id: "incoming",
      date: "2026-07-23",
      flightNo: "CX937",
      position: "G20",
      staffId: "2",
      staffName: "华嘉慧",
      startTime: "08:30",
      endTime: "10:30",
      workHours: 2,
      fatiguePoints: 4,
      remark: "",
    } satisfies HistoryRecord;
    state.history = [{ ...history, id: "old" }];

    applyWorkbookImport(
      state,
      { staff: [], history: [history], warnings: [] },
      "history"
    );
    expect(state.staff).toEqual(originalStaff);
    expect(state.history).toEqual([history]);
  });

  it("removes manual standby overrides invalidated by an imported qualification", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.dutyRosterOverrides = [
      {
        date: "2026-08-01",
        cxPreflightStaffId: null,
        dutyStaffId: null,
        standbyStaffIds: [person.id, null],
      },
    ];
    const importedStaff = state.staff.map((item) =>
      item.id === person.id ? { ...item, standbyQualified: false } : item
    );

    applyWorkbookImport(
      state,
      { staff: importedStaff, warnings: [] },
      "config"
    );

    expect(state.dutyRosterOverrides).toEqual([]);
  });

  it("merges imported rule settings, preserves omitted settings, and clears the active schedule", () => {
    const state = createDefaultState();
    const originalAdminMode = state.settings.adminSupportEnabled;
    const originalHighLoadThreshold = state.settings.highLoadFatigueThreshold;
    state.assignments = [
      {
        id: "assignment",
        flightId: "flight",
        flightNo: "F1",
        positionRuleId: null,
        position: "临时岗位",
        staffId: null,
        staffName: "",
        startTime: "08:00",
        endTime: "09:00",
        workHours: 0,
        fatiguePoints: 0,
        remark: "",
        manualRemark: "",
        status: "manual",
      },
    ];
    state.activeScheduleDate = "2026-07-25";

    const result = applyWorkbookImport(
      state,
      {
        settings: {
          dutyFatiguePoints: 6,
          dutyPositionPriorities: [],
        },
        warnings: [],
      },
      "config"
    );

    expect(result).toEqual({ changedConfig: true, recognized: "规则配置" });
    expect(state.settings.dutyFatiguePoints).toBe(6);
    expect(state.settings.dutyPositionPriorities).toEqual([]);
    expect(state.settings.highLoadFatigueThreshold).toBe(
      originalHighLoadThreshold
    );
    expect(state.settings.adminSupportEnabled).toBe(originalAdminMode);
    expect(state.assignments).toEqual([]);
    expect(state.activeScheduleDate).toBeNull();
  });

  it("replaces one month's duty and next-day standby while preserving CX preflight", () => {
    const state = createDefaultState();
    const current = state.staff[0]!;
    current.cxPreflightQualified = true;
    state.dutyRosterOverrides = [
      {
        date: "2026-07-01",
        cxPreflightStaffId: current.id,
        dutyStaffId: state.staff[1]!.id,
        standbyStaffIds: [state.staff[2]!.id, state.staff[3]!.id],
      },
      {
        date: "2026-08-01",
        cxPreflightStaffId: null,
        dutyStaffId: state.staff[1]!.id,
        standbyStaffIds: [state.staff[2]!.id, state.staff[3]!.id],
      },
    ];
    const preview: DutyRosterImportPreview = {
      month: "2026-07",
      referenceDate: "2026-07-01",
      recognizedAssignments: 3,
      canApply: true,
      warnings: [],
      errors: [],
      rows: [
        {
          date: "2026-07-01",
          standbyDate: "2026-07-02",
          dutyStaffId: state.staff[4]!.id,
          standbyStaffIds: [state.staff[5]!.id, state.staff[6]!.id],
        },
      ],
    };

    const result = applyDutyRosterImport(state, preview);

    expect(result).toEqual({ importedDays: 1, importedAssignments: 3 });
    expect(
      state.dutyRosterOverrides.find((row) => row.date === "2026-07-01")
    ).toEqual({
      date: "2026-07-01",
      cxPreflightStaffId: current.id,
      dutyStaffId: state.staff[4]!.id,
      standbyStaffIds: [state.staff[5]!.id, state.staff[6]!.id],
    });
    expect(
      state.dutyRosterOverrides.some((row) => row.date === "2026-08-01")
    ).toBe(true);
  });

  it("blocks an imported duty person who is already the preserved CX preflight person", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    person.cxPreflightQualified = true;
    state.dutyRosterOverrides = [
      {
        date: "2026-07-01",
        cxPreflightStaffId: person.id,
        dutyStaffId: state.staff[1]!.id,
        standbyStaffIds: [state.staff[2]!.id, state.staff[3]!.id],
      },
    ];
    const preview: DutyRosterImportPreview = {
      month: "2026-07",
      referenceDate: "2026-07-01",
      recognizedAssignments: 3,
      canApply: true,
      warnings: [],
      errors: [],
      rows: [
        {
          date: "2026-07-01",
          standbyDate: "2026-07-02",
          dutyStaffId: person.id,
          standbyStaffIds: [state.staff[4]!.id, state.staff[5]!.id],
        },
      ],
    };

    const validated = validateDutyRosterImport(state, preview);

    expect(validated.canApply).toBe(false);
    expect(validated.errors.join("；")).toContain("同时承担CX航前");
    expect(applyDutyRosterImport(state, preview)).toEqual({
      importedDays: 0,
      importedAssignments: 0,
    });
  });

  it("preserves duty when a new month's first-day standby only covers the previous workday", () => {
    const state = createDefaultState();
    const existing = {
      date: "2026-07-31",
      cxPreflightStaffId: null,
      dutyStaffId: state.staff[0]!.id,
      standbyStaffIds: [state.staff[1]!.id, state.staff[2]!.id] as [
        string,
        string,
      ],
    };
    state.dutyRosterOverrides = [existing];
    const preview: DutyRosterImportPreview = {
      month: "2026-08",
      referenceDate: "2026-08-02",
      recognizedAssignments: 2,
      canApply: true,
      warnings: [],
      errors: [],
      rows: [
        {
          date: "2026-07-31",
          standbyDate: "2026-08-01",
          dutyStaffId: null,
          standbyStaffIds: [state.staff[3]!.id, state.staff[4]!.id],
          dutyIncluded: false,
          standbyIncluded: true,
        },
      ],
    };

    applyDutyRosterImport(state, preview);

    expect(state.dutyRosterOverrides[0]).toMatchObject({
      dutyStaffId: existing.dutyStaffId,
      standbyStaffIds: [state.staff[3]!.id, state.staff[4]!.id],
    });
  });
});
