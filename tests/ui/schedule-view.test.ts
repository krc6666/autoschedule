// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDefaultState } from "../../src/defaults";
import { generateSchedule } from "../helpers/generate-schedule";
import { schedulingDecision } from "../../src/domain/rules/schedule-rule-contract";
import "../../src/ui/components/schedule-page";
import { mountElement } from "./lit-test-helpers";

describe("schedule page", () => {
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
    const mainRow = workspace?.querySelector(":scope > .schedule-main-row");
    const roster = workspace?.querySelector(
      ":scope > autoschedule-duty-roster-summary"
    );
    expect(mainRow?.querySelector("autoschedule-staff-palette")).not.toBeNull();
    expect(mainRow?.querySelector("autoschedule-schedule-grid")).not.toBeNull();
    expect(roster?.previousElementSibling).toBe(mainRow);
  });

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
      nightShift: true,
      status: "正常",
      remark: "",
    });
    const assignment = state.assignments.find(
      (item) => item.status === "assigned"
    )!;
    assignment.decisionTrace = [
      schedulingDecision(
        "late-shift-recovery",
        "fallback",
        "上一班末班重点岗位人员作为最后兜底接替"
      ),
    ];
    state.schedulePolicyStale = true;
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
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
  });
});
