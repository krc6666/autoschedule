// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDefaultState } from "../../src/defaults";
import { generateSchedule } from "../helpers/generate-schedule";
import { schedulingDecision } from "../../src/domain/rules/schedule-rule-contract";
import {
  UI_COMMAND_EVENT,
  type UiCommandEvent,
} from "../../src/ui/events/ui-command";
import "../../src/ui/components/schedule-page";
import { mountElement, settleLit } from "./lit-test-helpers";

describe("schedule page", () => {
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
      /autoschedule-staff-palette,\s*autoschedule-schedule-grid,\s*autoschedule-duty-roster-summary\s*\{(?<declarations>[^}]*)\}/
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
      ":scope > autoschedule-duty-roster-summary"
    );
    expect(palette).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(roster?.previousElementSibling).toBe(grid);
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
});
