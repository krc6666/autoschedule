import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { getMonthlyDutyRoster, updateDutyRosterSlot } from "../domain/duty-roster";
import { generateSchedule } from "../domain/scheduler";
import { renderSchedule } from "./schedule-view";

describe("schedule view", () => {
  it("renders aligned Bootstrap table rows without dropping configured remarks", () => {
    const state = createDefaultState();
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    state.activeScheduleDate = "2026-07-18";
    const html = renderSchedule(state, "2026-07-18");
    expect(html).toContain("table table-sm table-bordered");
    expect(html).toContain("position-remark");
    expect(html).toContain("申报");
    expect(html).toContain("data-empty-slot");
    expect(html).toContain("引导岗位");
    expect(html).not.toContain("支援与行政");
    expect(html).not.toContain("flight-column-cells");
    expect(html).toContain("是否启用行政支援模式");
    expect(html).not.toContain("行政支援人员");
    expect(html).toContain("data-action=\"load-sort-field\"");
    expect(html).toContain("data-action=\"load-sort-direction\"");
    expect(html).toContain("data-action=\"zoom-schedule-out\"");
    expect(html).toContain("data-action=\"zoom-schedule-reset\"");
    expect(html).toContain("data-action=\"zoom-schedule-in\"");
    expect(html).toContain("归档并排后天");
    expect(html).toContain("排班反馈");
    expect(html).toContain('class="schedule-feedback-list"');
    expect(html).toContain("人员覆盖");
    expect(html).toContain("航班衔接");
    expect(html).toContain("上一工作日晚班");
    expect(html).toContain("本月备勤席位不足");
    expect(html).toContain("不计入违约");
    expect(html).toContain("月度轻松班次统计");
    expect(html).toContain("今日提前下班");
    expect(html).toContain("今日下午无航班");
    expect(html).toContain("--schedule-column-width:64px");
    expect(html).toContain('<th scope="col" colspan="2">');
    expect(html).toContain('class="schedule-subhead-position">岗位</th>');
    expect(html).toContain('class="schedule-subhead-person">人员</th>');
    expect(html.match(/class="schedule-position-column"/g)).toHaveLength(state.flights.length);
    expect(html.match(/class="schedule-person-column"/g)).toHaveLength(state.flights.length);
  });

  it("renders the selected schedule zoom level", () => {
    const state = createDefaultState();
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const html = renderSchedule(state, "2026-07-18", { field: "totalFatigue", direction: "desc", zoom: 1.5 });
    expect(html).toContain("150%");
    expect(html).toContain("--schedule-column-width:96px");
    expect(html).toContain("--schedule-position-size:16.5px");
  });

  it("shows the four-person duty summary and an editable monthly rotation table", () => {
    const state = createDefaultState();
    state.staff.slice(0, 3).forEach((person) => { person.cxPreflightQualified = true; });
    state.assignments = generateSchedule(state, "2026-07-20").assignments;
    const html = renderSchedule(state, "2026-07-20");
    expect(html).toContain("CX航前");
    expect(html).toContain("值班人员");
    expect(html).toContain("备勤人员");
    expect(html).toContain("CX航前轮换");
    expect(html).toContain("值班与备勤轮换");
    expect(html).toContain("本月值班");
    expect(html).toContain("本月备勤");
    expect(html).toContain("首轮覆盖");
    expect(html).toContain("航前差值");
    expect(html).toContain("备勤差值");
    expect(html).toContain("值班保障");
    expect(html).toContain("计划疲劳");
    expect(html).toContain(`本次值班 +${state.settings.dutyFatiguePoints} 疲劳点`);
    expect(html).toContain("轮值日期");
    expect(html).toContain("duty-roster-table");
    expect(html).toContain('data-entity="duty-roster"');
    expect(html).toContain('data-duty-slot="standby-1"');
    expect(html).toMatch(/<section class="schedule-workspace">[\s\S]*?class="[^"]*schedule-board[^"]*"[\s\S]*?class="duty-roster-summary"[\s\S]*?<\/section>/);
    expect(html.indexOf('class="duty-roster-summary"')).toBeLessThan(html.indexOf("duty-roster-details-section"));
  });

  it("keeps a sole CX-qualified worker in the first duty round", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => person.status === "正常");
    state.staff.forEach((person) => {
      person.dutyQualified = true;
      person.cxPreflightQualified = person.name === "刘翔";
    });
    state.assignments = generateSchedule(state, "2026-08-01").assignments;
    const html = renderSchedule(state, "2026-08-01");
    expect(html).not.toContain("值班首轮未完成");
    expect(html).toContain("值班优先后，本月 1 个工作日没有剩余CX航前资质人员");
    expect(html).toContain("首轮覆盖 <strong>16/16</strong>");
  });

  it("offers monthly rebalancing when a manual change creates zero and repeated duty counts", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => person.status === "正常");
    state.staff.forEach((person) => { person.dutyQualified = true; });
    const rows = getMonthlyDutyRoster(state, "2026-08-01");
    const repeated = state.staff.find((person) => rows.some((row) => row.dutyStaffId === person.id))!;
    const target = rows.find((row) => row.dutyStaffId !== repeated.id && row.cxPreflightStaffId !== repeated.id && !row.standbyStaffIds.includes(repeated.id))!;
    expect(updateDutyRosterSlot(state, target.date, "duty", repeated.id)).toBeNull();
    state.assignments = generateSchedule(state, "2026-08-01").assignments;
    const html = renderSchedule(state, "2026-08-01");
    expect(html).toContain("值班均衡未完成");
    expect(html).toContain(`${repeated.name} 2 次`);
    expect(html).toContain("月度值班需纠偏");
    expect(html).toContain('data-action="rebalance-duty-roster-month"');
  });

  it("renders position details and personnel details in separate table cells", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const assignment = state.assignments.find((item) => item.remark === "申报")!;
    assignment.manualRemark = "临时调整";
    const html = renderSchedule(state, "2026-07-18");
    expect(html).toMatch(/<td class="schedule-grid-slot schedule-position-slot">[\s\S]*?<span class="position-remark"[^>]*>申报<\/span>[\s\S]*?<\/td><td class="schedule-grid-slot schedule-person-slot">/);
    expect(html).toMatch(/<td class="schedule-grid-slot schedule-person-slot">[\s\S]*?class="schedule-name-input"[\s\S]*?class="schedule-manual-remark" value="临时调整"[\s\S]*?<\/td>/);
  });

  it("keeps supervisor positions at the top without extra markers", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 2);
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "supervisor", flightNo: "F1", name: "督导", category: "机动督导", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "counter", flightNo: "F1", name: "超规柜台", category: "常规", qualifiedStaffIds: [] }
    ];
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const html = renderSchedule(state, "2026-07-18");
    expect(html).toContain("引导岗位");
    expect(html).not.toContain("督导补位");
    expect(html.indexOf("超规柜台")).toBeLessThan(html.indexOf("引导岗位"));
  });

  it("shows a separate administrative roster only when support mode is enabled", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    state.staff.push({ id: "A1", name: "行政一号", staffType: "行政支援", teamLeader: false, cxPreflightQualified: false, dutyQualified: false, nightShift: true, status: "正常", remark: "" });
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const html = renderSchedule(state, "2026-07-18");
    expect(html).toContain("行政支援人员");
    expect(html).toContain("行政一号");
    expect(html).toContain("staff-palette-item is-admin-support");
    const loadSection = html.slice(html.indexOf('class="workspace-section load-details"'));
    expect(loadSection).not.toContain("行政一号");
  });
});
