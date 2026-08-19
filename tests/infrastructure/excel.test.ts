import * as XLSX from "xlsx-js-style";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { generateSchedule } from "../helpers/generate-schedule";
import {
  buildConfigWorkbook,
  buildScheduleWorkbook,
  parseWorkbook,
} from "../../src/infrastructure/excel";
import { replaceWeeklyFlightPlan } from "../../src/domain/flights/weekly-flight-plan";
import { SCHEDULE_SETTING_DEFINITIONS } from "../../src/domain/rules/schedule-settings";

describe("workbook boundary", () => {
  it("round-trips manual late-priority frequency corrections by flight and category", () => {
    const state = createDefaultState();
    state.latePriorityFrequencyAdjustments = [
      {
        month: "2026-08",
        staffId: state.staff[0]!.id,
        flightNo: "TR121",
        kind: "number-one",
        delta: -2,
        resetBaseline: 2,
      },
    ];
    const workbook = buildConfigWorkbook(state);
    expect(workbook.SheetNames).toContain("末班重点次数修正");
    expect(
      parseWorkbook(workbook, state.staff).latePriorityFrequencyAdjustments
    ).toEqual(state.latePriorityFrequencyAdjustments);
  });

  it("maps workbook rows into stable domain models", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["编号", "姓名", "是否可上夜班", "状态", "备注"],
        ["9", "Test", "否", "正常", "R"],
      ]),
      "人员信息"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["航班号", "开始时间", "结束时间", "涉及岗位", "备注"],
        ["AB123", "8:30:00", "10:30", "P1，P2", "R"],
      ]),
      "航班计划"
    );
    const imported = parseWorkbook(workbook, []);
    expect(imported.staff).toEqual([
      {
        id: "9",
        name: "Test",
        staffType: "常规",
        teamLeader: false,
        cxPreflightQualified: false,
        dutyQualified: true,
        standbyQualified: true,
        nightShift: false,
        status: "正常",
        remark: "R",
      },
    ]);
    expect(imported.flights?.[0]).toMatchObject({
      flightNo: "AB123",
      startTime: "08:30",
      endTime: "10:30",
      positions: ["P1", "P2"],
    });
  });

  it("exports both operational and machine-readable schedule views", async () => {
    const state = createDefaultState();
    const assignments = (await generateSchedule(state, "2026-07-18"))
      .assignments;
    assignments[0]!.manualOverrideWarnings = [
      { code: "daily-hours", message: "人员A 将超过每日工时上限" },
    ];
    const workbook = buildScheduleWorkbook(assignments, "2026-07-18");
    expect(workbook.SheetNames).toHaveLength(3);
    expect(workbook.Sheets[workbook.SheetNames[0]!]!["!ref"]).toBeTruthy();
    expect(workbook.Sheets[workbook.SheetNames[1]!]!["!ref"]).toBeTruthy();
    const machineRows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets["排班结果"]!,
      { header: 1, raw: false, defval: "" }
    );
    const onePosition = machineRows.find(
      (row) => row[1] === "CX937" && row[2] === "G20"
    );
    expect(onePosition?.[8]).toBe("一号");
    expect(machineRows.flat().join(" ")).toContain(
      "人工调整提醒：人员A 将超过每日工时上限"
    );
  }, 30_000);

  it("imports a flight configuration sheet as reusable templates", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["航班号", "开始时间", "结束时间", "涉及岗位", "备注"],
        ["AB123", "08:30", "10:30", "P1,P2", "到岗"],
      ]),
      "航班配置"
    );
    const imported = parseWorkbook(workbook, []);
    expect(imported.templates?.[0]).toMatchObject({
      flightNo: "AB123",
      positions: ["P1", "P2"],
      remark: "到岗",
    });
  });

  it("round-trips flight templates and passenger thresholds in configuration workbooks", () => {
    const state = createDefaultState();
    state.positionRules[0]!.minPassengers = 30;
    state.positionRules[0]!.category = "分流";
    state.positionRules[0]!.earlyReleaseMinutes = 45;
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.templates).toHaveLength(state.templates.length);
    expect(imported.positionRules?.[0]).toMatchObject({
      minPassengers: 30,
      category: "分流",
      earlyReleaseMinutes: 45,
    });
  });

  it("round-trips weekly flight plans and treats an empty sheet as a cleared plan", () => {
    const state = createDefaultState();
    state.weeklyFlightPlans = replaceWeeklyFlightPlan(
      state.weeklyFlightPlans,
      1,
      [state.templates[0]!.flightNo, state.templates[1]!.flightNo]
    );
    state.weeklyFlightPlans = replaceWeeklyFlightPlan(
      state.weeklyFlightPlans,
      7,
      [state.templates[2]!.flightNo]
    );

    const exported = buildConfigWorkbook(state);
    const imported = parseWorkbook(exported, state.staff);

    expect(exported.SheetNames).toContain("每周航班计划");
    expect(imported.weeklyFlightPlans).toEqual(state.weeklyFlightPlans);

    const emptyWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      emptyWorkbook,
      XLSX.utils.aoa_to_sheet([["星期", "航班号（用逗号分隔）"]]),
      "每周航班计划"
    );
    expect(parseWorkbook(emptyWorkbook, state.staff).weeklyFlightPlans).toEqual(
      createDefaultState().weeklyFlightPlans
    );
  });

  it("round-trips cross-flight priority policies", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      {
        id: "priority-1",
        enabled: true,
        flightNo: "KE166",
        positions: ["督导", "H02", "H03", "H04"],
      },
    ];
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.settings?.crossFlightPriorityPolicies).toEqual(
      state.settings.crossFlightPriorityPolicies
    );
  });

  it("round-trips administrative support position categories", () => {
    const state = createDefaultState();
    state.positionRules[0]!.category = "行政支援";
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.positionRules?.[0]?.category).toBe("行政支援");
  });

  it("round-trips supervisor position categories", () => {
    const state = createDefaultState();
    state.positionRules[0]!.category = "机动督导";
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.positionRules?.[0]?.category).toBe("机动督导");
  });

  it("keeps regular and administrative rules with the same position name", () => {
    const state = createDefaultState();
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "regular", name: "督导", category: "常规" },
      { ...base, id: "admin", name: "督导", category: "行政支援" },
    ];
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.positionRules?.map((rule) => rule.category)).toEqual([
      "常规",
      "行政支援",
    ]);
  });

  it("ignores removed support-category rows", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["航班号", "项目分类", "岗位名称", "备注", "可胜任人员"],
        ["AB123", "支援", "旧支援岗位", "", "手动输入项"],
      ]),
      "岗位配置"
    );
    expect(parseWorkbook(workbook, []).positionRules).toEqual([]);
  });

  it("round-trips administrative support personnel types", () => {
    const state = createDefaultState();
    state.staff[0]!.staffType = "行政支援";
    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);
    expect(imported.staff?.[0]?.staffType).toBe("行政支援");
    expect(imported.staff?.[0]?.standbyQualified).toBe(false);
  });

  it("round-trips the team-leader personnel flag", () => {
    const state = createDefaultState();
    state.staff[0]!.teamLeader = true;

    const imported = parseWorkbook(buildConfigWorkbook(state), state.staff);

    expect(imported.staff?.[0]?.teamLeader).toBe(true);
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

  it("round-trips standby personnel qualifications", () => {
    const state = createDefaultState();
    state.staff[0]!.standbyQualified = false;
    const workbook = buildConfigWorkbook(state);
    const imported = parseWorkbook(workbook, state.staff);
    const headers = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets["人员信息"]!,
      { header: 1, raw: false, defval: "" }
    )[0];

    expect(headers).toContain("备勤资质");
    expect(imported.staff?.[0]?.standbyQualified).toBe(false);
  });

  it("ships a downloadable configuration template with current qualification and rule fields", () => {
    const workbook = XLSX.readFile(
      join(process.cwd(), "public", "template", "排班工具配置模板.xlsx")
    );
    const headers = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets["人员信息"]!,
      { header: 1, raw: false, defval: "" }
    )[0];

    expect(headers).toContain("备勤资质");
    expect(workbook.SheetNames).toEqual(
      expect.arrayContaining([
        "每周航班计划",
        "岗位衔接规则",
        "值班岗位优先",
        "次班恢复目标",
        "末班重点岗位",
        "机动督导范围",
        "跨工作日资质预留",
        "跨航班重点岗位优先",
        "末班重点航班范围",
      ])
    );
    const settingCodes = XLSX.utils
      .sheet_to_json<unknown[]>(workbook.Sheets["规则参数"]!, {
        header: 1,
        raw: false,
        defval: "",
      })
      .slice(1)
      .map((row) => row[0]);
    expect(settingCodes).toEqual(
      SCHEDULE_SETTING_DEFINITIONS.map((definition) => definition.key)
    );
    const imported = parseWorkbook(workbook, []);
    const defaultState = createDefaultState();
    const { adminSupportEnabled: _adminSupportEnabled, ...defaultSettings } =
      defaultState.settings;
    expect(imported.settings).toEqual(defaultSettings);
    expect(imported.weeklyFlightPlans).toEqual(defaultState.weeklyFlightPlans);
  });

  it("round-trips every editable scheduling setting and rule table", () => {
    const state = createDefaultState();
    state.settings.maxDailyHours = 9.5;
    state.settings.historyWindowDays = 12;
    state.settings.nightStart = "21:30";
    state.settings.nightEnd = "05:30";
    state.settings.dutyFatiguePoints = 7.5;
    state.settings.lateShiftEndTime = "23:30";
    state.settings.nextWorkdayRecoveryMode = "forbid";
    state.settings.teamLeaderConcurrentSupervisionMaxOverlapMinutes = 45;
    state.settings.minimumRegularTransitionMinutes = 90;
    state.settings.earlyDepartureCutoffTime = "11:45";
    state.settings.positionTransitionPolicies = [
      {
        id: "transition-export",
        name: "测试衔接",
        enabled: true,
        sourceFlightNo: "CX937",
        sourcePositions: ["G20", "G19"],
        targetFlightNo: "TR121",
        targetPosition: "H02",
        minimumGapMinutes: 180,
        mode: "forbid",
      },
    ];
    state.settings.dutyPositionPriorities = [
      {
        id: "duty-export",
        flightNo: "TR121",
        positionKeyword: "H02",
        enabled: true,
      },
    ];
    state.settings.nextWorkdayRecoveryTargets = [
      {
        id: "recovery-export",
        flightNo: "CX937",
        positionKeyword: "控制",
        enabled: true,
      },
    ];
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-export",
        enabled: true,
        flightNo: "TR121",
        matchField: "position",
        keyword: "H02",
        nextWorkdayCutoffTime: "14:30",
      },
    ];
    state.settings.mobileSupervisorCoverageRules = [
      {
        id: "supervisor-export",
        enabled: true,
        flightNo: "KE166",
        matchField: "remark",
        keyword: "一号",
        mode: "forbid",
      },
    ];
    state.settings.crossWorkdayQualificationReservations = [
      {
        id: "reservation-export",
        enabled: true,
        flightNo: "CX931",
        matchField: "remark",
        keyword: "控制",
        minimumStaffCount: 1,
      },
    ];
    state.settings.latePriorityFlightNumbers = ["TR121", "TW616"];
    const workbook = buildConfigWorkbook(state);
    const imported = parseWorkbook(workbook, state.staff);

    expect(workbook.SheetNames).toEqual(
      expect.arrayContaining([
        "规则参数",
        "岗位衔接规则",
        "值班岗位优先",
        "次班恢复目标",
        "末班重点岗位",
        "机动督导范围",
        "跨工作日资质预留",
        "末班重点航班范围",
      ])
    );
    expect(workbook.SheetNames).not.toContain("规则执行顺序");
    const { adminSupportEnabled: _adminSupportEnabled, ...exportedSettings } =
      state.settings;
    expect(imported.settings).toEqual(exportedSettings);
    expect(imported.settings).not.toHaveProperty("adminSupportEnabled");
    expect(workbook.SheetNames).not.toContain("值班备勤表");
  });

  it("keeps settings absent when importing an older configuration workbook", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["航班号", "开始时间", "结束时间", "涉及岗位", "备注"],
        ["AB123", "08:30", "10:30", "P1", ""],
      ]),
      "航班配置"
    );

    expect(parseWorkbook(workbook, []).settings).toBeUndefined();
  });

  it("treats a present rule sheet with only a header as an explicit clear", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["规则ID", "航班号", "岗位关键词", "启用"]]),
      "值班岗位优先"
    );

    expect(
      parseWorkbook(workbook, []).settings?.dutyPositionPriorities
    ).toEqual([]);
  });

  it("keeps present empty configuration sheets distinguishable from missing sheets", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["编号", "姓名", "是否可上夜班", "状态", "备注"],
      ]),
      "人员信息"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["航班号", "开始时间", "结束时间", "涉及岗位", "备注"],
      ]),
      "航班配置"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["航班号", "项目分类", "岗位名称", "备注", "可胜任人员"],
      ]),
      "岗位配置"
    );

    const imported = parseWorkbook(workbook, createDefaultState().staff);

    expect(imported.staff).toEqual([]);
    expect(imported.templates).toEqual([]);
    expect(imported.positionRules).toEqual([]);
    expect(imported.warnings).toEqual([]);
  });

  it("does not bind imported history to old-device staff after an explicit staff clear", () => {
    const current = createDefaultState();
    const person = current.staff[0]!;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["编号", "姓名", "是否可上夜班", "状态", "备注"],
      ]),
      "人员信息"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["日期", "航班号", "岗位", "姓名", "开始时间", "结束时间"],
        ["2026-08-19", "CX937", "G20", person.name, "08:00", "10:00"],
      ]),
      "历史排班"
    );

    const imported = parseWorkbook(workbook, current.staff);

    expect(imported.staff).toEqual([]);
    expect(imported.history?.[0]?.staffId).toBe("");
  });

  it("rejects one invalid rule sheet without blocking another valid sheet", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["规则ID", "航班号", "岗位关键词", "启用"],
        ["bad-duty", "TR121", "H02", "不确定"],
      ]),
      "值班岗位优先"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["规则ID", "航班号", "岗位关键词", "启用"],
        ["valid-recovery", "CX937", "控制", "是"],
      ]),
      "次班恢复目标"
    );

    const imported = parseWorkbook(workbook, []);

    expect(imported.settings).not.toHaveProperty("dutyPositionPriorities");
    expect(imported.settings?.nextWorkdayRecoveryTargets).toEqual([
      {
        id: "valid-recovery",
        flightNo: "CX937",
        positionKeyword: "控制",
        enabled: true,
      },
    ]);
    expect(imported.warnings.join("\n")).toContain("值班岗位优先第2行");
  });

  it("preserves rule ids and worksheet row order", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["规则ID", "航班号", "岗位关键词", "启用"],
        ["second", "TR121", "送资料", "是"],
        ["first", "TR121", "H02", "否"],
      ]),
      "值班岗位优先"
    );

    expect(
      parseWorkbook(workbook, []).settings?.dutyPositionPriorities
    ).toEqual([
      {
        id: "second",
        flightNo: "TR121",
        positionKeyword: "送资料",
        enabled: true,
      },
      {
        id: "first",
        flightNo: "TR121",
        positionKeyword: "H02",
        enabled: false,
      },
    ]);
  });

  it("exports manually entered names and cell remarks in the horizontal detail", async () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    const assignments = (await generateSchedule(state, "2026-07-18"))
      .assignments;
    const flight = state.flights[0]!;
    const manualRule = state.positionRules.find(
      (item) => item.flightNo === flight.flightNo && item.name === "超规柜台"
    )!;
    assignments.push({
      id: "manual",
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: manualRule.id,
      position: manualRule.name,
      staffId: null,
      staffName: "临时人员",
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: 2,
      fatiguePoints: manualRule.fatiguePoints,
      remark: manualRule.remark,
      manualRemark: "09:00-10:00",
      status: "assigned",
    });
    const workbook = buildScheduleWorkbook(assignments, "2026-07-18");
    const detail = XLSX.utils
      .sheet_to_json<unknown[]>(workbook.Sheets["保障明细"]!, {
        header: 1,
        raw: false,
        defval: "",
      })
      .flat();
    expect(detail).toContain("临时人员\n09:00-10:00");
  });
});
