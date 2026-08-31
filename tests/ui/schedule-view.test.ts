// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDefaultState } from "../../src/defaults";
import { generateSchedule } from "../helpers/generate-schedule";
import { schedulingDecision } from "../../src/domain/rules/schedule-rule-contract";
import { buildMonthlyRelaxedShiftStatistics } from "../../src/domain/statistics/relaxed-shift-statistics";
import {
  UI_COMMAND_EVENT,
  type UiCommandEvent,
} from "../../src/ui/events/ui-command";
import "../../src/ui/components/schedule-page";
import { mountElement, settleLit } from "./lit-test-helpers";

describe("schedule page", () => {
  it("shows only qualified idle staff when a position is selected", async () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const rule = state.positionRules.find(
      (item) => item.flightNo === flight.flightNo && item.category === "常规"
    )!;
    const [available, busy, unqualified] = state.staff.slice(0, 3);
    state.staff = [available!, busy!, unqualified!];
    rule.qualifiedStaffIds = [available!.id, busy!.id];
    state.assignments = [
      {
        id: "target-assignment",
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: rule.id,
        position: rule.name,
        staffId: null,
        staffName: "",
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 0,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
        manualRemark: "",
        status: "unfilled",
      },
      {
        id: "busy-assignment",
        flightId: "other-flight",
        flightNo: "OTHER",
        positionRuleId: rule.id,
        position: rule.name,
        staffId: busy!.id,
        staffName: busy!.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 2,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
        manualRemark: "",
        status: "assigned",
      },
    ];
    const commands: UiCommandEvent["detail"][] = [];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-08-03",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
      halfRestStaffIds: [],
    });
    element.addEventListener(UI_COMMAND_EVENT, (event) => {
      commands.push((event as UiCommandEvent).detail);
    });

    element
      .querySelector<HTMLButtonElement>(
        `button[aria-label="查看${rule.name}可用人员"]`
      )
      ?.click();
    await settleLit();

    const menu = element.querySelector<HTMLElement>(".schedule-candidate-menu");
    expect(menu?.textContent).toContain(available!.name);
    expect(menu?.textContent).not.toContain(busy!.name);
    expect(menu?.textContent).not.toContain(unqualified!.name);

    const candidateTrigger = element.querySelector<HTMLButtonElement>(
      `button[aria-label="查看${rule.name}当前合格空闲人员"]`
    );
    expect(candidateTrigger).toBeTruthy();
    candidateTrigger?.click();
    await settleLit();
    expect(element.querySelector(".schedule-candidate-menu")).toBeNull();
    candidateTrigger?.click();
    await settleLit();
    expect(element.querySelector(".schedule-candidate-menu")).toBeTruthy();

    element
      .querySelector<HTMLButtonElement>(".schedule-candidate-option")
      ?.click();
    expect(commands.at(-1)).toEqual({
      type: "assign-staff",
      assignmentId: "target-assignment",
      staffId: available!.id,
    });
  });

  it("selects multiple regular staff as current-date half-rest preferences", async () => {
    const state = createDefaultState();
    state.assignments = [];
    const selectable = state.staff
      .filter(
        (person) => person.status === "正常" && person.staffType === "常规"
      )
      .slice(0, 2);
    const commands: UiCommandEvent["detail"][] = [];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-08-03",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
      halfRestStaffIds: [],
    });
    element.addEventListener(UI_COMMAND_EVENT, (event) => {
      commands.push((event as UiCommandEvent).detail);
    });

    expect(element.textContent).toContain("半休人员");
    const inputs = selectable.map((person) =>
      element.querySelector<HTMLInputElement>(
        `input[aria-label="${person.name}设为半休"]`
      )
    );
    expect(inputs.every(Boolean)).toBe(true);
    inputs[0]!.click();
    inputs[1]!.click();

    expect(commands.at(-1)).toEqual({
      type: "set-half-rest-staff",
      staffIds: selectable.map((person) => person.id),
    });
  });

  it("marks only half-rest shortages red", async () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const rules = state.positionRules
      .filter((rule) => rule.flightNo === flight.flightNo && !rule.manual)
      .slice(0, 2);
    state.assignments = rules.map((rule, index) => ({
      id: `vacancy-${index}`,
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: null,
      staffName: "",
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: 0,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
      manualRemark: "",
      status: "unfilled" as const,
      ...(index === 0
        ? { systemNotes: ["半休安排：后续可用人员不足，岗位保持空缺"] }
        : {}),
    }));
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-08-03",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
      halfRestStaffIds: [],
    });

    expect(
      element.querySelector('[data-assignment-id="vacancy-0"]')?.classList
    ).toContain("is-half-rest-unfilled");
    expect(
      element.querySelector('[data-assignment-id="vacancy-1"]')?.classList
    ).not.toContain("is-half-rest-unfilled");
  });

  it("keeps the administrative switch controlled until its command is applied", async () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = false;
    const commands: UiCommandEvent["detail"][] = [];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-toolbar", {
      model: state,
      date: "2026-07-18",
      zoom: 1,
    });
    element.addEventListener(UI_COMMAND_EVENT, (event) => {
      commands.push((event as UiCommandEvent).detail);
    });
    const input = element.querySelector<HTMLInputElement>(
      ".admin-support-switch input"
    )!;

    input.click();

    expect(commands).toContainEqual({
      type: "toggle-administrative-mode",
      enabled: true,
    });
    expect(input.checked).toBe(false);
  }, 30_000);

  it("opens flight confirmation from the reschedule toolbar action", async () => {
    const state = createDefaultState();
    const commands: UiCommandEvent["detail"][] = [];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-toolbar", {
      model: state,
      date: "2026-08-29",
      zoom: 1,
    });
    element.addEventListener(UI_COMMAND_EVENT, (event) => {
      commands.push((event as UiCommandEvent).detail);
    });

    [...element.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("重新排班"))
      ?.click();

    expect(commands.at(-1)).toEqual({
      type: "open-reschedule-flight-picker",
    });
  });

  it("toggles the nearest earlier archived workday above the current schedule", async () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const person = state.staff[0]!;
    state.assignments = [
      {
        id: "current-assignment",
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: null,
        position: "当前岗位",
        staffId: person.id,
        staffName: person.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];
    state.history = [
      {
        id: "older",
        date: "2026-07-16",
        flightNo: "CX937",
        position: "旧岗位",
        staffId: "staff-older",
        staffName: "较早人员",
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
      },
      {
        id: "previous",
        date: "2026-07-18",
        flightNo: "TR121",
        position: "上一班岗位",
        staffId: "staff-previous",
        staffName: "上一班人员",
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 4,
        remark: "一号",
      },
      {
        id: "same-date",
        date: "2026-07-20",
        flightNo: "CX931",
        position: "当天归档",
        staffId: "staff-same",
        staffName: "当天人员",
        startTime: "17:50",
        endTime: "19:50",
        workHours: 2,
        fatiguePoints: 3,
        remark: "",
      },
    ];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-07-20",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
    });
    const comparisonButton = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("对比上一班")
    );

    expect(comparisonButton).toBeDefined();
    expect(element.querySelector(".previous-schedule-comparison")).toBeNull();
    comparisonButton?.click();
    await settleLit();

    const comparison = element.querySelector(".previous-schedule-comparison");
    expect(comparison?.textContent).toContain("2026-07-18");
    expect(comparison?.textContent).toContain("上一班人员");
    expect(comparison?.textContent).not.toContain("较早人员");
    expect(comparison?.textContent).not.toContain("当天人员");
    expect(
      comparison?.querySelector('[aria-label="删除这条历史记录"]')
    ).toBeNull();
    expect(element.textContent).toContain("收起上一班");

    [...element.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("收起上一班"))
      ?.click();
    await settleLit();
    expect(element.querySelector(".previous-schedule-comparison")).toBeNull();
  });

  it("disables previous-workday comparison when no earlier archive exists", async () => {
    const state = createDefaultState();
    state.assignments = [
      {
        id: "current-assignment",
        flightId: state.flights[0]!.id,
        flightNo: state.flights[0]!.flightNo,
        positionRuleId: null,
        position: "当前岗位",
        staffId: state.staff[0]!.id,
        staffName: state.staff[0]!.name,
        startTime: state.flights[0]!.startTime,
        endTime: state.flights[0]!.endTime,
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];
    state.history = [];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-07-20",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
    });
    const unavailableButton = [...element.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("暂无上一班记录")
    );

    expect(unavailableButton).toBeDefined();
    expect(unavailableButton?.hasAttribute("disabled")).toBe(true);
  });

  it("stretches the schedule grid across available desktop width", () => {
    const styles = readFileSync(
      join(process.cwd(), "src", "styles.css"),
      "utf8"
    );
    const scheduleTableRule = styles.match(
      /\.schedule-grid-table\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const declarations = document.createElement("div").style;
    declarations.cssText = scheduleTableRule ?? "";

    expect(declarations.width).toBe("100%");
    expect(declarations.minWidth).toBe(
      "calc(var(--flight-count) * var(--schedule-flight-width))"
    );
  });

  it("keeps the wide flight table inside its own mobile scroll boundary", () => {
    const styles = readFileSync(
      join(process.cwd(), "src", "styles.css"),
      "utf8"
    );
    const hostRule = styles.match(
      /autoschedule-staff-palette,\s*autoschedule-schedule-grid,\s*autoschedule-duty-roster-summary,\s*autoschedule-schedule-relaxed-shift-summary\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const boardRule = styles.match(
      /\.schedule-board\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const host = document.createElement("div").style;
    const board = document.createElement("div").style;
    host.cssText = hostRule ?? "";
    board.cssText = boardRule ?? "";

    expect(host.display).toBe("block");
    expect(host.minWidth).toBe("0");
    expect(host.maxWidth).toBe("100%");
    expect(board.width).toBe("100%");
    expect(board.maxWidth).toBe("100%");
    expect(board.overflowX).toBe("auto");
  });

  it("places the duty summary beside the desktop board and above narrow layouts", () => {
    const styles = readFileSync(
      join(process.cwd(), "src", "styles.css"),
      "utf8"
    );
    const desktop = styles.match(
      /\.schedule-workspace\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;
    const narrow = styles.match(
      /@media \(max-width: 1000px\)[\s\S]*?\.schedule-workspace\s*\{(?<declarations>[^}]*)\}/
    )?.groups?.declarations;

    expect(desktop).toContain('grid-template-areas: "staff board roster"');
    expect(narrow).toContain(
      'grid-template-areas: "roster roster" "staff board"'
    );
  });

  it("shows today's relaxed-shift lists beside the schedule using statistics-page facts", async () => {
    const state = createDefaultState();
    const [earlyPerson, afternoonFreePerson] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    const rule = state.positionRules.find(
      (item) => item.category === "常规" && !item.manual
    )!;
    state.staff = [earlyPerson!, afternoonFreePerson!];
    state.activeScheduleDate = "2026-07-18";
    state.dutyRosterOverrides = [
      {
        date: "2026-07-18",
        cxPreflightStaffId: null,
        dutyStaffId: null,
        standbyStaffIds: [null, null],
      },
    ];
    state.history = [
      {
        id: "previous-early",
        date: "2026-07-16",
        flightNo: "EARLY100",
        position: rule.name,
        staffId: earlyPerson!.id,
        staffName: earlyPerson!.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
      },
    ];
    state.assignments = [
      {
        id: "current-early",
        flightId: "early-flight",
        flightNo: "EARLY100",
        positionRuleId: rule.id,
        position: rule.name,
        staffId: earlyPerson!.id,
        staffName: earlyPerson!.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "current-noon",
        flightId: "noon-flight",
        flightNo: "NOON200",
        positionRuleId: rule.id,
        position: rule.name,
        staffId: afternoonFreePerson!.id,
        staffName: afternoonFreePerson!.name,
        startTime: "10:00",
        endTime: "12:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];
    const statistics = buildMonthlyRelaxedShiftStatistics(state, "2026-07-18");
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-07-18",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
    });
    const summary = element.querySelector(".schedule-relaxed-shift-summary");
    const text = summary?.textContent ?? "";

    expect(summary).not.toBeNull();
    expect(text).toContain("提前下班人员");
    expect(text).toContain("下午无航班人员");
    for (const item of statistics.currentEarlyDepartures) {
      expect(text).toContain(item.staffName);
      expect(text).toContain(`${item.flightNo} / ${item.cutoffTime}`);
      expect(text).toContain(`本月 ${item.monthlyCount} 次`);
    }
    for (const item of statistics.currentAfternoonRest) {
      expect(text).toContain(item.staffName);
      expect(text).toContain(`本月 ${item.monthlyCount} 次`);
    }
  });

  it("queries regular staff flights by workday using compact flight-only tags", async () => {
    const state = createDefaultState();
    const regular = state.staff.find((person) => person.staffType === "常规")!;
    const administrative = {
      ...regular,
      id: "administrative",
      name: "行政人员",
      staffType: "行政支援" as const,
    };
    state.staff = [regular, administrative];
    state.activeScheduleDate = "2026-09-13";
    state.assignments = [
      {
        id: "current-cx-1",
        flightId: "current-cx",
        flightNo: "CX931",
        positionRuleId: null,
        position: "G18",
        staffId: regular.id,
        staffName: regular.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "current-cx-2",
        flightId: "current-cx",
        flightNo: "CX931",
        positionRuleId: null,
        position: "G20",
        staffId: regular.id,
        staffName: regular.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "current-admin",
        flightId: "current-tr",
        flightNo: "TR121",
        positionRuleId: null,
        position: "H02",
        staffId: administrative.id,
        staffName: administrative.name,
        startTime: "12:00",
        endTime: "14:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];
    state.history = [
      {
        id: "archived-ke",
        date: "2026-09-11",
        flightNo: "KE166",
        position: "K01",
        staffId: regular.id,
        staffName: regular.name,
        startTime: "07:00",
        endTime: "09:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        historyCoverage: "complete",
      },
    ];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-09-13",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
    });
    const statistics = element.querySelector(
      "autoschedule-daily-staff-flight-statistics"
    )!;
    const currentTag = statistics.querySelector(".daily-staff-flight-tag")!;

    expect(currentTag.textContent?.replace(/\s+/g, " ").trim()).toBe(
      `${regular.name} CX931`
    );
    expect(currentTag.textContent).not.toContain("G18");
    expect(currentTag.textContent).not.toContain("2026-09-13");
    expect(statistics.textContent).not.toContain(administrative.name);

    const dateInput = statistics.querySelector<HTMLInputElement>(
      'input[aria-label="人员航班查询日期"]'
    )!;
    dateInput.value = "2026-09-11";
    dateInput.dispatchEvent(new Event("change"));
    await settleLit();

    expect(
      statistics
        .querySelector(".daily-staff-flight-tag")
        ?.textContent?.replace(/\s+/g, " ")
        .trim()
    ).toBe(`${regular.name} KE166`);
    expect(statistics.textContent).not.toContain("CX931");
  });

  it("highlights only the last schedule cell for today's early-departure staff", async () => {
    const state = createDefaultState();
    const [earlyPerson, afternoonFreePerson, regularPerson] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 3);
    const rule = state.positionRules.find(
      (item) => item.category === "常规" && !item.manual
    )!;
    state.staff = [earlyPerson!, afternoonFreePerson!, regularPerson!];
    state.activeScheduleDate = "2026-07-18";
    state.settings.earlyDepartureCutoffTime = "13:00";
    state.settings.afternoonRestStartTime = "13:00";
    state.settings.afternoonRestEndTime = "17:00";
    state.dutyRosterOverrides = [
      {
        date: "2026-07-18",
        cxPreflightStaffId: null,
        dutyStaffId: null,
        standbyStaffIds: [null, null],
      },
    ];
    state.flights = [
      {
        id: "morning-flight",
        flightNo: "TEST100",
        startTime: "08:00",
        endTime: "09:00",
        remark: "",
        bookedPassengers: 0,
        positions: [],
      },
      {
        id: "noon-flight",
        flightNo: "TEST200",
        startTime: "10:00",
        endTime: "12:00",
        remark: "",
        bookedPassengers: 0,
        positions: [],
      },
      {
        id: "afternoon-flight",
        flightNo: "TEST300",
        startTime: "14:00",
        endTime: "16:00",
        remark: "",
        bookedPassengers: 0,
        positions: [],
      },
      {
        id: "evening-flight",
        flightNo: "TEST400",
        startTime: "18:00",
        endTime: "19:00",
        remark: "",
        bookedPassengers: 0,
        positions: [],
      },
    ];
    const assignment = (
      id: string,
      flightIndex: number,
      staff: (typeof state.staff)[number]
    ) => ({
      id,
      flightId: state.flights[flightIndex]!.id,
      flightNo: state.flights[flightIndex]!.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: staff.id,
      staffName: staff.name,
      startTime: state.flights[flightIndex]!.startTime,
      endTime: state.flights[flightIndex]!.endTime,
      workHours: 1,
      fatiguePoints: 1,
      remark: "",
      manualRemark: "",
      status: "assigned" as const,
    });
    state.assignments = [
      assignment("early-first", 0, earlyPerson!),
      assignment("early-last", 1, earlyPerson!),
      assignment("afternoon-free-last", 3, afternoonFreePerson!),
      assignment("regular-last", 2, regularPerson!),
    ];
    const statistics = buildMonthlyRelaxedShiftStatistics(state, "2026-07-18");

    expect(
      statistics.currentEarlyDepartures.map((item) => item.staffId)
    ).toContain(earlyPerson!.id);
    expect(
      statistics.currentEarlyDepartures.map((item) => item.staffId)
    ).not.toContain(afternoonFreePerson!.id);
    expect(
      statistics.currentAfternoonRest.map((item) => item.staffId)
    ).toContain(afternoonFreePerson!.id);

    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-07-18",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
    });

    expect(
      element.querySelector('[data-assignment-id="early-first"]')?.classList
    ).not.toContain("is-early-departure-last");
    expect(
      element.querySelector('[data-assignment-id="early-last"]')?.classList
    ).toContain("is-early-departure-last");
    expect(
      element.querySelector('[data-assignment-id="afternoon-free-last"]')
        ?.classList
    ).not.toContain("is-early-departure-last");
    expect(
      element.querySelector('[data-assignment-id="regular-last"]')?.classList
    ).not.toContain("is-early-departure-last");
  });

  it("renders the complete toolbar, aligned grid, remarks, duty summary, feedback, and load controls", async () => {
    const state = createDefaultState();
    state.assignments = (
      await generateSchedule(state, "2026-07-18")
    ).assignments;
    state.activeScheduleDate = "2026-07-18";
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-07-18",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
    });
    const text = element.textContent ?? "";

    [
      "重新排班",
      "归档并排后天",
      "导出结果",
      "仅归档",
      "是否启用行政支援模式",
    ].forEach((label) => expect(text).toContain(label));
    [
      "导出 HTML",
      "导出图片",
      "清空排班",
      "缩小排班表",
      "恢复 100%",
      "放大排班表",
    ].forEach((label) =>
      expect(element.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
    );
    expect(element.querySelectorAll('th[colspan="2"]')).toHaveLength(
      state.flights.length
    );
    expect(element.querySelectorAll(".schedule-position-column")).toHaveLength(
      state.flights.length
    );
    expect(text).toContain("申报");
    expect(text).toContain("次日备勤人员");
    expect(text).toContain("排班反馈");
    expect(text).toContain("人员覆盖");
    expect(text).toContain("航班衔接");
    expect(
      element.querySelector('select[aria-label="负荷排序字段"]')
    ).not.toBeNull();
    expect(
      element.querySelector('select[aria-label="负荷排序方向"]')
    ).not.toBeNull();
    const workspace = element.querySelector(".schedule-workspace");
    const palette = workspace?.querySelector(
      ":scope > autoschedule-staff-palette"
    );
    const grid = workspace?.querySelector(
      ":scope > autoschedule-schedule-grid"
    );
    const roster = workspace?.querySelector(
      ":scope > .schedule-side-panel > autoschedule-duty-roster-summary"
    );
    const relaxedShiftSummary = workspace?.querySelector(
      ":scope > .schedule-side-panel > autoschedule-schedule-relaxed-shift-summary"
    );
    expect(palette).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(roster).not.toBeNull();
    expect(relaxedShiftSummary).not.toBeNull();
  }, 30_000);

  it("preserves stale warnings, zoom projection, administrative staff, and soft-rule evidence", async () => {
    const state = createDefaultState();
    state.assignments = (
      await generateSchedule(state, "2026-07-18")
    ).assignments;
    state.settings.adminSupportEnabled = true;
    state.staff.push({
      id: "A1",
      name: "行政一号",
      staffType: "行政支援",
      teamLeader: false,
      cxPreflightQualified: false,
      dutyQualified: false,
      standbyQualified: false,
      nightShift: true,
      status: "正常",
      remark: "",
    });
    const assignment = state.assignments.find(
      (item) => item.status === "assigned"
    )!;
    state.assignments.forEach((item) => delete item.decisionTrace);
    assignment.decisionTrace = [
      schedulingDecision(
        "cross-workday-load",
        "fallback",
        "上一班甲比乙更累，本班仍由甲承担较重岗位"
      ),
      schedulingDecision(
        "late-shift-recovery",
        "fallback",
        "上一班末班重点岗位人员作为最后兜底接替"
      ),
    ];
    state.schedulePolicyStale = true;
    const element = await mountElement<
      HTMLElement & { model: typeof state; updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-07-18",
      zoom: 1.5,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
    });

    expect(element.textContent).toContain(
      "排班规则已更新，当前排班尚未按新规则重新生成"
    );
    expect(element.textContent).toContain("行政支援人员");
    expect(
      element.querySelector<HTMLInputElement>(
        'input[aria-label="行政支援人员姓名"]'
      )?.value
    ).toBe("行政一号");
    expect(element.textContent).toContain("150%");
    expect(
      element
        .querySelector(".schedule-soft-warning-icon")
        ?.getAttribute("title")
    ).toContain("上一班末班重点岗位人员作为最后兜底接替");
    const warningButton = element.querySelector<HTMLButtonElement>(
      'button[aria-label="分析这个岗位的调换方案"]'
    );
    expect(warningButton).not.toBeNull();
    const commands: UiCommandEvent["detail"][] = [];
    element.addEventListener(UI_COMMAND_EVENT, (event) => {
      commands.push((event as UiCommandEvent).detail);
    });
    warningButton?.click();
    expect(commands).toContainEqual({
      type: "open-swap-analysis",
      assignmentId: assignment.id,
    });

    const comparisonOnlyState = structuredClone(state);
    const comparisonOnlyAssignment = comparisonOnlyState.assignments.find(
      (item) => item.id === assignment.id
    )!;
    comparisonOnlyAssignment.decisionTrace = [
      schedulingDecision(
        "cross-workday-load",
        "fallback",
        "上一班甲比乙更累，本班仍由甲承担较重岗位"
      ),
    ];
    element.model = comparisonOnlyState;
    await element.updateComplete;
    const grid = element.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-schedule-grid");
    await grid?.updateComplete;

    expect(element.querySelector(".schedule-soft-warning-icon")).toBeNull();
    expect(comparisonOnlyAssignment.decisionTrace).toHaveLength(1);
  }, 30_000);

  it("shows a persistent yellow warning icon for a manual override", async () => {
    const state = createDefaultState();
    state.assignments = (
      await generateSchedule(state, "2026-07-18")
    ).assignments;
    const assignment = state.assignments[0]!;
    assignment.manualOverrideWarnings = [
      {
        code: "position-qualification",
        message: `${assignment.staffName || "人员A"} 不具备该岗位资质`,
      },
    ];
    const element = await mountElement<
      HTMLElement & { model: typeof state; updateComplete: Promise<unknown> }
    >("autoschedule-schedule-page", {
      model: state,
      date: "2026-07-18",
      zoom: 1,
      loadSortField: "totalFatigue",
      loadSortDirection: "desc",
    });

    const icon = element.querySelector(".schedule-manual-warning-icon");
    expect(icon?.getAttribute("title")).toContain("不具备该岗位资质");
    expect(
      icon
        ?.closest(".schedule-cell")
        ?.classList.contains("is-manual-override-warning")
    ).toBe(true);
  }, 30_000);
});
