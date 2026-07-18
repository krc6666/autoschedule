import type { AppState, Assignment } from "../model";
import { buildStaffLoads } from "../domain/fatigue";
import { isFixedBottomPosition } from "../domain/scheduler";
import { escapeHtml, visiblePositionRemark } from "../utils";

function assignmentCell(state: AppState, assignment: Assignment): string {
  const assigned = Boolean(assignment.staffId);
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  const temporary = !rule && Boolean(assignment.layoutGroup);
  const support = rule?.category === "支援" || assignment.position === "临时支援";
  const adminSupport = rule?.category === "行政支援";
  const auxiliary = support || adminSupport || !rule;
  const diversion = rule?.category === "分流";
  const positionRemark = visiblePositionRemark(assignment.remark);
  const positionControl = temporary
    ? `<input class="schedule-position-input" value="${escapeHtml(assignment.position)}" data-entity="assignment" data-id="${assignment.id}" data-field="position" aria-label="临时岗位名称">`
    : `<strong class="schedule-position" title="${escapeHtml(assignment.position)}">${support ? `<span class="support-tag">支</span>` : adminSupport ? `<span class="admin-support-tag">行</span>` : diversion ? `<span class="diversion-tag">流</span>` : ""}${escapeHtml(assignment.position)}</strong>`;
  return `<article class="schedule-cell ${assignment.staffName ? "is-assigned" : "is-unfilled"} ${support ? "is-support" : ""} ${adminSupport ? "is-admin-support" : ""} ${diversion ? "is-diversion" : ""}" data-drop-assignment="${assignment.id}">
    <div class="schedule-cell-main">${positionControl}
    <div class="schedule-person-edit" ${assigned ? `data-drag-assignment="${assignment.id}" title="按住姓名可拖到任意岗位"` : ""}>${assigned ? `<i class="bi bi-grip-vertical assignment-drag-handle" aria-hidden="true"></i>` : ""}<input class="schedule-name-input" ${auxiliary ? "" : `list="schedule-staff-names"`} value="${escapeHtml(assignment.staffName)}" data-entity="assignment" data-id="${assignment.id}" data-field="staffName" aria-label="${escapeHtml(assignment.position)}人员">${positionRemark ? `<span class="position-remark" title="${escapeHtml(positionRemark)}">${escapeHtml(positionRemark)}</span>` : ""}</div>
    <div class="schedule-cell-actions">
      <button class="btn btn-sm btn-light icon-btn" type="button" data-action="clear-assignment" data-id="${assignment.id}" title="清空人员"><i class="bi bi-eraser"></i></button>
      ${!rule || support ? `<button class="btn btn-sm btn-light icon-btn" type="button" data-action="delete-assignment" data-id="${assignment.id}" title="删除本次临时岗位"><i class="bi bi-x-lg"></i></button>` : ""}
    </div></div>
    <input class="schedule-manual-remark" value="${escapeHtml(assignment.manualRemark)}" placeholder=" " title="输入临时备注" data-entity="assignment" data-id="${assignment.id}" data-field="manualRemark" aria-label="${escapeHtml(assignment.position)}临时备注">
  </article>`;
}

function emptyScheduleCell(flightId: string, layoutGroup: "primary" | "bottom", layoutIndex: number): string {
  return `<div class="schedule-cell schedule-cell-placeholder" data-empty-slot data-flight-id="${escapeHtml(flightId)}" data-layout-group="${layoutGroup}" data-layout-index="${layoutIndex}">
    <input class="schedule-empty-input schedule-empty-position" placeholder="岗位" data-action="create-temporary-assignment" data-empty-field="position" aria-label="新增临时岗位">
    <input class="schedule-empty-input schedule-empty-name" placeholder="人员" data-action="create-temporary-assignment" data-empty-field="staffName" aria-label="新增临时人员">
  </div>`;
}

export function renderSchedule(state: AppState, date: string): string {
  if (!state.assignments.length) {
    return `<section class="workspace-section empty-workspace"><i class="bi bi-calendar2-plus"></i><h3>尚未生成排班</h3><button class="btn btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-stars me-2"></i>生成排班</button></section>`;
  }
  const loads = buildStaffLoads(state.staff, state.assignments, state.history, date, state.settings)
    .sort((left, right) => right.totalFatigue - left.totalFatigue);
  const flights = [...state.flights].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const groups = flights.map((flight) => {
    const assignments = state.assignments.filter((item) => item.flightId === flight.id);
    const ordered = (items: Assignment[]) => items.map((item, index) => ({ item, index }))
      .sort((left, right) => (left.item.layoutIndex ?? left.index) - (right.item.layoutIndex ?? right.index) || left.index - right.index)
      .map(({ item }) => item);
    return {
      flight,
      primary: ordered(assignments.filter((item) => item.layoutGroup === "primary" || (item.layoutGroup !== "bottom" && !isFixedBottomPosition(item.position)))),
      bottom: ordered(assignments.filter((item) => item.layoutGroup === "bottom" || (item.layoutGroup !== "primary" && isFixedBottomPosition(item.position))))
    };
  });
  const primaryRowCount = Math.max(0, ...groups.map((group) => group.primary.length)) + 1;
  const bottomRowCount = Math.max(0, ...groups.map((group) => group.bottom.length)) + 1;
  const flightHeaders = groups.map(({ flight, primary }) => {
    const hasShortage = primary.some((item) => item.status === "unfilled");
    const configuredSupport = state.positionRules.some((rule) => rule.flightNo === flight.flightNo && rule.category === "支援");
    const canAddMorningSupport = hasShortage && flight.startTime < "12:00";
    const supportButton = configuredSupport || canAddMorningSupport
      ? `<button class="btn btn-sm ${hasShortage ? "btn-outline-warning" : "btn-outline-primary"} icon-btn" type="button" data-action="add-schedule-slot" data-id="${flight.id}" title="添加已配置的支援岗位"><i class="bi bi-person-plus"></i></button>`
      : "";
    return `<th scope="col"><div class="schedule-flight-head"><div><strong>${escapeHtml(flight.flightNo)}</strong><span>${escapeHtml(flight.startTime)}–${escapeHtml(flight.endTime)}</span>${flight.remark ? `<small>${escapeHtml(flight.remark)}</small>` : ""}</div>${supportButton}</div></th>`;
  }).join("");
  const primaryRows = Array.from({ length: primaryRowCount }, (_, rowIndex) => `<tr>${groups.map(({ flight, primary }) => `<td class="schedule-grid-slot">${primary[rowIndex] ? assignmentCell(state, primary[rowIndex]) : emptyScheduleCell(flight.id, "primary", rowIndex)}</td>`).join("")}</tr>`).join("");
  const bottomRows = Array.from({ length: bottomRowCount }, (_, rowIndex) => `<tr>${groups.map(({ flight, bottom }) => `<td class="schedule-grid-slot">${bottom[rowIndex] ? assignmentCell(state, bottom[rowIndex]) : emptyScheduleCell(flight.id, "bottom", rowIndex)}</td>`).join("")}</tr>`).join("");
  const auxiliaryDivider = `<tr class="schedule-divider-row">${groups.map(() => `<td><div class="support-divider"><span>引导岗位</span></div></td>`).join("")}</tr>`;
  return `
    <section class="toolbar-band schedule-toolbar"><div class="d-flex gap-1 flex-wrap"><button class="btn btn-sm btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-arrow-repeat me-1"></i>重新排班</button><button class="btn btn-sm btn-success" type="button" data-action="archive-and-next"><i class="bi bi-calendar2-plus me-1"></i>归档并排明天</button><button class="btn btn-sm btn-outline-success" type="button" data-action="export-schedule"><i class="bi bi-file-earmark-excel me-1"></i>导出结果</button><button class="btn btn-sm btn-outline-primary icon-btn" type="button" data-action="export-share-html" title="导出 HTML"><i class="bi bi-filetype-html"></i></button><button class="btn btn-sm btn-outline-primary icon-btn" type="button" data-action="export-share-png" title="导出图片"><i class="bi bi-file-earmark-image"></i></button><button class="btn btn-sm btn-outline-secondary" type="button" data-action="archive-schedule"><i class="bi bi-archive me-1"></i>仅归档</button><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="clear-schedule" title="清空排班"><i class="bi bi-x-circle"></i></button></div><span class="small text-secondary">${escapeHtml(date)}</span></section>
    <section class="schedule-workspace">
      <aside class="staff-palette"><div class="staff-palette-head"><strong>人员名单</strong><span>${state.staff.filter((person) => person.status === "正常").length} 人可用</span></div>
        <div class="staff-palette-list">${state.staff.map((person) => `<div class="staff-palette-item ${person.status !== "正常" ? "is-disabled" : ""}" draggable="${person.status === "正常"}" data-drag-staff="${person.id}" title="#${escapeHtml(person.id)} ${escapeHtml(person.status)}"><i class="bi bi-grip-vertical"></i><span>${escapeHtml(person.name)}</span></div>`).join("")}</div>
      </aside>
      <div class="table-responsive schedule-board">
        <table class="table table-sm table-bordered align-middle mb-0 schedule-grid-table" style="--flight-count:${Math.max(1, flights.length)}">
          <thead><tr>${flightHeaders}</tr></thead>
          <tbody>${primaryRows}${auxiliaryDivider}${bottomRows}</tbody>
        </table>
      </div>
    </section>
    <datalist id="schedule-staff-names">${state.staff.filter((person) => person.status === "正常").map((person) => `<option value="${escapeHtml(person.name)}"></option>`).join("")}</datalist>
    <details class="workspace-section load-details"><summary>人员负荷与疲劳</summary><div class="table-responsive mt-3"><table class="table table-sm align-middle data-table"><thead><tr><th>人员</th><th>状态</th><th>当日工时</th><th>岗位疲劳</th><th>历史疲劳</th><th>总疲劳</th></tr></thead><tbody>
      ${loads.map((load) => `<tr><td>${escapeHtml(load.staff.name)}</td><td>${escapeHtml(load.staff.status)}</td><td>${load.workHours.toFixed(1)}h</td><td>${load.todayFatigue.toFixed(1)}</td><td>${load.historyFatigue.toFixed(1)}</td><td><span class="badge ${load.totalFatigue >= 20 ? "text-bg-danger" : load.totalFatigue >= 10 ? "text-bg-warning" : "text-bg-success"}">${load.totalFatigue.toFixed(1)}</span></td></tr>`).join("")}
    </tbody></table></div></details>`;
}
