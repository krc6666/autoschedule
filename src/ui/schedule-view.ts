import type { AppState, Assignment, Staff } from "../model";
import { buildStaffLoads } from "../domain/fatigue";
import { buildScheduleFeedback } from "../domain/schedule-feedback";
import { dutyFatigueByStaff } from "../domain/duty-roster";
import { isFixedBottomPosition } from "../domain/scheduler";
import { escapeHtml, visiblePositionRemark } from "../utils";
import { renderDutyRosterDetails, renderDutyRosterSummary } from "./duty-roster-view";

export type LoadSortField = "workHours" | "todayFatigue" | "historyFatigue" | "totalFatigue";
export type LoadSortDirection = "asc" | "desc";

export interface LoadSortOptions {
  field: LoadSortField;
  direction: LoadSortDirection;
}

export interface ScheduleViewOptions extends LoadSortOptions {
  zoom?: number;
}

function assignmentCells(state: AppState, assignment: Assignment): string {
  const assigned = Boolean(assignment.staffId);
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  const temporary = !rule && Boolean(assignment.layoutGroup);
  const guide = rule?.category === "引导";
  const adminSupport = rule?.category === "行政支援";
  const auxiliary = adminSupport || !rule;
  const diversion = rule?.category === "分流";
  const positionRemark = visiblePositionRemark(assignment.remark);
  const positionControl = temporary
    ? `<input class="schedule-position-input" value="${escapeHtml(assignment.position)}" data-entity="assignment" data-id="${assignment.id}" data-field="position" aria-label="临时岗位名称">`
    : `<strong class="schedule-position" title="${escapeHtml(assignment.position)}">${guide ? `<span class="guide-tag">引</span>` : adminSupport ? `<span class="admin-support-tag">行</span>` : diversion ? `<span class="diversion-tag">流</span>` : ""}${escapeHtml(assignment.position)}</strong>`;
  const stateClasses = `${assignment.staffName ? "is-assigned" : "is-unfilled"} ${guide ? "is-guide" : ""} ${adminSupport ? "is-admin-support" : ""} ${diversion ? "is-diversion" : ""}`;
  return `<td class="schedule-grid-slot schedule-position-slot"><article class="schedule-cell schedule-position-cell ${stateClasses}">
    <div class="schedule-position-content">${positionControl}${positionRemark ? `<span class="position-remark" title="${escapeHtml(positionRemark)}">${escapeHtml(positionRemark)}</span>` : ""}</div>
    ${temporary ? `<div class="schedule-cell-actions"><button class="btn btn-sm btn-light icon-btn" type="button" data-action="delete-assignment" data-id="${assignment.id}" title="删除本次临时岗位"><i class="bi bi-x-lg"></i></button></div>` : ""}
  </article></td><td class="schedule-grid-slot schedule-person-slot"><article class="schedule-cell schedule-person-cell ${stateClasses}" data-drop-assignment="${assignment.id}">
    <div class="schedule-person-edit" ${assigned ? `data-drag-assignment="${assignment.id}" title="按住姓名可拖动调整岗位"` : ""}>${assigned ? `<i class="bi bi-grip-vertical assignment-drag-handle" aria-hidden="true"></i>` : ""}<input class="schedule-name-input" ${auxiliary ? "" : `list="schedule-staff-names"`} value="${escapeHtml(assignment.staffName)}" data-entity="assignment" data-id="${assignment.id}" data-field="staffName" aria-label="${escapeHtml(assignment.position)}人员"></div>
    <div class="schedule-cell-actions"><button class="btn btn-sm btn-light icon-btn" type="button" data-action="clear-assignment" data-id="${assignment.id}" title="清空人员"><i class="bi bi-eraser"></i></button></div>
    <input class="schedule-manual-remark" value="${escapeHtml(assignment.manualRemark)}" placeholder=" " title="输入临时备注" data-entity="assignment" data-id="${assignment.id}" data-field="manualRemark" aria-label="${escapeHtml(assignment.position)}临时备注">
  </article></td>`;
}

function emptyScheduleCells(flightId: string, layoutGroup: "primary" | "bottom", layoutIndex: number): string {
  const slotData = `data-empty-slot data-flight-id="${escapeHtml(flightId)}" data-layout-group="${layoutGroup}" data-layout-index="${layoutIndex}"`;
  return `<td class="schedule-grid-slot schedule-position-slot"><div class="schedule-cell schedule-cell-placeholder schedule-position-cell" ${slotData}>
    <input class="schedule-empty-input schedule-empty-position" placeholder="岗位" data-action="create-temporary-assignment" data-empty-field="position" aria-label="新增临时岗位">
  </div></td><td class="schedule-grid-slot schedule-person-slot"><div class="schedule-cell schedule-cell-placeholder schedule-person-cell" ${slotData}>
    <input class="schedule-empty-input schedule-empty-name" placeholder="人员" data-action="create-temporary-assignment" data-empty-field="staffName" aria-label="新增临时人员">
  </div></td>`;
}

function staffPaletteItem(person: Staff, administrative: boolean): string {
  const disabled = person.status !== "正常";
  return `<div class="staff-palette-item ${administrative ? "is-admin-support" : ""} ${disabled ? "is-disabled" : ""}" draggable="${!disabled}" data-drag-staff="${escapeHtml(person.id)}" title="#${escapeHtml(person.id)} ${escapeHtml(person.status)}">
    <i class="bi bi-grip-vertical"></i>
    ${administrative
      ? `<input class="staff-palette-name" value="${escapeHtml(person.name)}" data-entity="staff" data-id="${escapeHtml(person.id)}" data-field="name" aria-label="行政支援人员姓名"><button class="btn btn-sm icon-btn" type="button" data-action="delete-staff" data-id="${escapeHtml(person.id)}" title="删除行政支援人员"><i class="bi bi-x"></i></button>`
      : `<span>${escapeHtml(person.name)}</span>`}
  </div>`;
}

function isBottomAssignment(state: AppState, assignment: Assignment): boolean {
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  return rule?.category === "引导" || isFixedBottomPosition(assignment.position);
}

export function renderSchedule(
  state: AppState,
  date: string,
  options: ScheduleViewOptions = { field: "totalFatigue", direction: "desc" }
): string {
  if (!state.assignments.length) {
    return `<section class="workspace-section empty-workspace"><i class="bi bi-calendar2-plus"></i><h3>尚未生成排班</h3><button class="btn btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-stars me-2"></i>生成排班</button></section>`;
  }
  const loads = buildStaffLoads(state.staff.filter((person) => person.staffType !== "行政支援"), state.assignments, state.history, date, state.settings, dutyFatigueByStaff(state, date))
    .sort((left, right) => {
      const result = left[options.field] - right[options.field];
      return (options.direction === "asc" ? result : -result) || left.staff.name.localeCompare(right.staff.name, "zh-CN");
    });
  const zoom = Math.min(1.6, Math.max(0.7, options.zoom ?? 1));
  const scaled = (value: number): number => Number((value * zoom).toFixed(1));
  const regularStaff = state.staff.filter((person) => person.staffType !== "行政支援");
  const administrativeStaff = state.staff.filter((person) => person.staffType === "行政支援");
  const flights = [...state.flights].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const groups = flights.map((flight) => {
    const assignments = state.assignments.filter((item) => item.flightId === flight.id);
    const ordered = (items: Assignment[]) => items.map((item, index) => ({ item, index }))
      .sort((left, right) => (left.item.layoutIndex ?? left.index) - (right.item.layoutIndex ?? right.index) || left.index - right.index)
      .map(({ item }) => item);
    return {
      flight,
      primary: ordered(assignments.filter((item) => item.layoutGroup === "primary" || (item.layoutGroup !== "bottom" && !isBottomAssignment(state, item)))),
      bottom: ordered(assignments.filter((item) => item.layoutGroup === "bottom" || (item.layoutGroup !== "primary" && isBottomAssignment(state, item))))
    };
  });
  const primaryRowCount = Math.max(0, ...groups.map((group) => group.primary.length)) + 1;
  const bottomRowCount = Math.max(0, ...groups.map((group) => group.bottom.length)) + 1;
  const columnGroups = groups.map(() => `<col class="schedule-position-column"><col class="schedule-person-column">`).join("");
  const flightHeaders = groups.map(({ flight }) => `<th scope="col" colspan="2"><div class="schedule-flight-head"><div><strong>${escapeHtml(flight.flightNo)}</strong><span>${escapeHtml(flight.startTime)}–${escapeHtml(flight.endTime)}</span>${flight.remark ? `<small>${escapeHtml(flight.remark)}</small>` : ""}</div></div></th>`).join("");
  const subHeaders = groups.map(() => `<th scope="col" class="schedule-subhead-position">岗位</th><th scope="col" class="schedule-subhead-person">人员</th>`).join("");
  const primaryRows = Array.from({ length: primaryRowCount }, (_, rowIndex) => `<tr>${groups.map(({ flight, primary }) => primary[rowIndex] ? assignmentCells(state, primary[rowIndex]) : emptyScheduleCells(flight.id, "primary", rowIndex)).join("")}</tr>`).join("");
  const bottomRows = Array.from({ length: bottomRowCount }, (_, rowIndex) => `<tr>${groups.map(({ flight, bottom }) => bottom[rowIndex] ? assignmentCells(state, bottom[rowIndex]) : emptyScheduleCells(flight.id, "bottom", rowIndex)).join("")}</tr>`).join("");
  const auxiliaryDivider = `<tr class="schedule-divider-row">${groups.map(() => `<td colspan="2"><div class="support-divider"><span>引导岗位</span></div></td>`).join("")}</tr>`;
  const scheduleStyle = [
    `--flight-count:${Math.max(1, flights.length)}`,
    `--schedule-column-width:${scaled(64)}px`,
    `--schedule-person-column-width:${scaled(56)}px`,
    `--schedule-flight-width:${scaled(120)}px`,
    `--schedule-header-height:${scaled(50)}px`,
    `--schedule-cell-height:${scaled(36)}px`,
    `--schedule-flight-size:${scaled(14)}px`,
    `--schedule-position-size:${scaled(11)}px`,
    `--schedule-small-size:${scaled(10)}px`,
    `--schedule-tiny-size:${scaled(9)}px`,
    `--schedule-input-height:${scaled(19)}px`,
    `--schedule-name-width:${scaled(48)}px`,
    `--schedule-divider-height:${scaled(20)}px`
  ].join(";");
  const zoomPercent = Math.round(zoom * 100);
  const feedback = buildScheduleFeedback(state, date);
  const feedbackIcon = (level: "ok" | "attention" | "info"): string => level === "ok" ? "check-circle-fill" : level === "attention" ? "exclamation-triangle-fill" : "info-circle-fill";
  const renderFeedbackGroup = (group: "flight-staff" | "rule-execution", title: string, description: string): string => `<div class="schedule-feedback-group"><div class="schedule-feedback-group-heading"><strong>${title}</strong><span>${description}</span></div><div class="schedule-feedback-list">${feedback.filter((item) => item.group === group).map((item) => `<div class="schedule-feedback-item is-${item.level}"><i class="bi bi-${feedbackIcon(item.level)}"></i><strong>${escapeHtml(item.label)}<em class="feedback-status is-${item.level}">${escapeHtml(item.status)}</em></strong><span>${escapeHtml(item.text)}</span></div>`).join("")}</div></div>`;
  return `
    <section class="toolbar-band schedule-toolbar"><div class="d-flex gap-1 flex-wrap"><button class="btn btn-sm btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-arrow-repeat me-1"></i>重新排班</button><button class="btn btn-sm btn-success" type="button" data-action="archive-and-next-duty"><i class="bi bi-calendar2-plus me-1"></i>归档并排后天</button><button class="btn btn-sm btn-outline-success" type="button" data-action="export-schedule"><i class="bi bi-file-earmark-excel me-1"></i>导出结果</button><button class="btn btn-sm btn-outline-primary icon-btn" type="button" data-action="export-share-html" title="导出 HTML"><i class="bi bi-filetype-html"></i></button><button class="btn btn-sm btn-outline-primary icon-btn" type="button" data-action="export-share-png" title="导出图片"><i class="bi bi-file-earmark-image"></i></button><button class="btn btn-sm btn-outline-secondary" type="button" data-action="archive-schedule"><i class="bi bi-archive me-1"></i>仅归档</button><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="clear-schedule" title="清空排班"><i class="bi bi-x-circle"></i></button></div><div class="schedule-toolbar-meta"><div class="schedule-zoom-control" role="group" aria-label="排班表缩放"><button class="btn btn-sm icon-btn" type="button" data-action="zoom-schedule-out" title="缩小排班表" ${zoom <= 0.7 ? "disabled" : ""}><i class="bi bi-zoom-out"></i></button><output aria-label="当前排班表比例">${zoomPercent}%</output><button class="btn btn-sm icon-btn" type="button" data-action="zoom-schedule-reset" title="恢复 100%"><i class="bi bi-arrow-counterclockwise"></i></button><button class="btn btn-sm icon-btn" type="button" data-action="zoom-schedule-in" title="放大排班表" ${zoom >= 1.6 ? "disabled" : ""}><i class="bi bi-zoom-in"></i></button></div><label class="form-check form-switch admin-support-switch" title="切换后会按当前模式重新排班"><input class="form-check-input" type="checkbox" data-action="toggle-admin-support-mode" ${state.settings.adminSupportEnabled ? "checked" : ""}><span class="form-check-label">是否启用行政支援模式</span></label><span class="small text-secondary">${escapeHtml(date)}</span></div></section>
    <section class="schedule-workspace">
      <aside class="staff-palette"><div class="staff-palette-section"><div class="staff-palette-head"><strong>常规人员</strong><span>${regularStaff.filter((person) => person.status === "正常").length} 人可用</span></div>
        <div class="staff-palette-list">${regularStaff.map((person) => staffPaletteItem(person, false)).join("")}</div></div>
        ${state.settings.adminSupportEnabled ? `<div class="staff-palette-section admin-support-palette"><div class="staff-palette-head"><strong>行政支援人员</strong><button class="btn btn-sm icon-btn" type="button" data-action="add-admin-staff" title="新增行政支援人员"><i class="bi bi-plus-lg"></i></button></div><div class="staff-palette-list">${administrativeStaff.map((person) => staffPaletteItem(person, true)).join("") || `<div class="staff-palette-empty">暂无人员</div>`}</div></div>` : ""}
      </aside>
      <div class="table-responsive schedule-board">
        <table class="table table-sm table-bordered align-middle mb-0 schedule-grid-table" style="${scheduleStyle}">
          <colgroup>${columnGroups}</colgroup>
          <thead><tr>${flightHeaders}</tr><tr class="schedule-subhead-row">${subHeaders}</tr></thead>
          <tbody>${primaryRows}${auxiliaryDivider}${bottomRows}</tbody>
        </table>
      </div>
      ${renderDutyRosterSummary(state, date)}
    </section>
    ${renderDutyRosterDetails(state, date)}
    <section class="workspace-section schedule-feedback"><div class="section-heading"><div><h3>排班反馈</h3><span>${escapeHtml(date)} · 自动核对当前结果、负荷和规则执行</span></div></div>
      ${renderFeedbackGroup("flight-staff", "一、航班安排反馈（航班与人员安排）", "航班密度、人员覆盖、工时与航班衔接")}
      ${renderFeedbackGroup("rule-execution", "二、规则执行反馈（规则执行情况）", "逐条标明已执行、需复核或暂无历史基准")}
    </section>
    <datalist id="schedule-staff-names">${state.staff.filter((person) => person.status === "正常" && (state.settings.adminSupportEnabled || person.staffType !== "行政支援")).map((person) => `<option value="${escapeHtml(person.name)}"></option>`).join("")}</datalist>
    <details class="workspace-section load-details"><summary>人员负荷与疲劳</summary><div class="load-sort-controls"><select class="form-select form-select-sm" data-action="load-sort-field" aria-label="负荷排序字段"><option value="workHours" ${options.field === "workHours" ? "selected" : ""}>当日工时</option><option value="todayFatigue" ${options.field === "todayFatigue" ? "selected" : ""}>岗位疲劳</option><option value="historyFatigue" ${options.field === "historyFatigue" ? "selected" : ""}>历史疲劳</option><option value="totalFatigue" ${options.field === "totalFatigue" ? "selected" : ""}>总疲劳</option></select><select class="form-select form-select-sm" data-action="load-sort-direction" aria-label="负荷排序方向"><option value="desc" ${options.direction === "desc" ? "selected" : ""}>从高到低</option><option value="asc" ${options.direction === "asc" ? "selected" : ""}>从低到高</option></select></div><div class="table-responsive mt-2"><table class="table table-sm align-middle data-table"><thead><tr><th>人员</th><th>状态</th><th>当日工时</th><th>岗位疲劳</th><th>历史疲劳</th><th>总疲劳</th></tr></thead><tbody>
      ${loads.map((load) => `<tr><td>${escapeHtml(load.staff.name)}</td><td>${escapeHtml(load.staff.status)}</td><td>${load.workHours.toFixed(1)}h</td><td>${load.todayFatigue.toFixed(1)}</td><td>${load.historyFatigue.toFixed(1)}</td><td><span class="badge ${load.totalFatigue >= 20 ? "text-bg-danger" : load.totalFatigue >= 10 ? "text-bg-warning" : "text-bg-success"}">${load.totalFatigue.toFixed(1)}</span></td></tr>`).join("")}
    </tbody></table></div></details>`;
}
