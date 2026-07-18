import type { AppState, Assignment } from "../model";
import { buildStaffLoads } from "../domain/fatigue";
import { escapeHtml, visiblePositionRemark } from "../utils";

function assignmentCell(state: AppState, assignment: Assignment): string {
  const assigned = Boolean(assignment.staffId);
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  const support = rule?.category === "支援" || !assignment.positionRuleId;
  const positionRemark = visiblePositionRemark(assignment.remark);
  return `<article class="schedule-cell ${assignment.staffName ? "is-assigned" : "is-unfilled"} ${support ? "is-support" : ""}" data-drop-assignment="${assignment.id}">
    <div class="schedule-cell-main"><strong class="schedule-position" title="${escapeHtml(assignment.position)}">${support ? `<span class="support-tag">支</span>` : ""}${escapeHtml(assignment.position)}</strong>
    <div class="schedule-person-edit">${assigned ? `<i class="bi bi-grip-vertical assignment-drag-handle" draggable="true" data-drag-assignment="${assignment.id}" title="拖拽人员"></i>` : ""}<input class="schedule-name-input" ${support ? "" : `list="schedule-staff-names"`} value="${escapeHtml(assignment.staffName)}" data-entity="assignment" data-id="${assignment.id}" data-field="staffName" aria-label="${escapeHtml(assignment.position)}人员">${positionRemark ? `<span class="position-remark">${escapeHtml(positionRemark)}</span>` : ""}</div>
    <div class="schedule-cell-actions">
      <button class="btn btn-sm btn-light icon-btn" type="button" data-action="clear-assignment" data-id="${assignment.id}" title="清空人员"><i class="bi bi-eraser"></i></button>
      ${support ? `<button class="btn btn-sm btn-light icon-btn" type="button" data-action="delete-assignment" data-id="${assignment.id}" title="移除本次支援岗位"><i class="bi bi-x-lg"></i></button>` : ""}
    </div></div>
    <input class="schedule-manual-remark" value="${escapeHtml(assignment.manualRemark)}" placeholder=" " title="输入临时备注" data-entity="assignment" data-id="${assignment.id}" data-field="manualRemark" aria-label="${escapeHtml(assignment.position)}临时备注">
  </article>`;
}

export function renderSchedule(state: AppState, date: string): string {
  if (!state.assignments.length) {
    return `<section class="workspace-section empty-workspace"><i class="bi bi-calendar2-plus"></i><h3>尚未生成排班</h3><button class="btn btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-stars me-2"></i>生成排班</button></section>`;
  }
  const loads = buildStaffLoads(state.staff, state.assignments, state.history, date, state.settings)
    .sort((left, right) => right.totalFatigue - left.totalFatigue);
  const flights = [...state.flights].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return `
    <section class="toolbar-band schedule-toolbar"><div class="d-flex gap-1 flex-wrap"><button class="btn btn-sm btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-arrow-repeat me-1"></i>重新排班</button><button class="btn btn-sm btn-success" type="button" data-action="archive-and-next"><i class="bi bi-calendar2-plus me-1"></i>归档并排明天</button><button class="btn btn-sm btn-outline-success" type="button" data-action="export-schedule"><i class="bi bi-file-earmark-excel me-1"></i>导出结果</button><button class="btn btn-sm btn-outline-primary icon-btn" type="button" data-action="export-share-html" title="导出 HTML"><i class="bi bi-filetype-html"></i></button><button class="btn btn-sm btn-outline-primary icon-btn" type="button" data-action="export-share-png" title="导出图片"><i class="bi bi-file-earmark-image"></i></button><button class="btn btn-sm btn-outline-secondary" type="button" data-action="archive-schedule"><i class="bi bi-archive me-1"></i>仅归档</button><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="clear-schedule" title="清空排班"><i class="bi bi-x-circle"></i></button></div><span class="small text-secondary">${escapeHtml(date)}</span></section>
    <section class="schedule-workspace">
      <aside class="staff-palette"><div class="staff-palette-head"><strong>人员名单</strong><span>${state.staff.filter((person) => person.status === "正常").length} 人可用</span></div>
        <div class="staff-palette-list">${state.staff.map((person) => `<div class="staff-palette-item ${person.status !== "正常" ? "is-disabled" : ""}" draggable="${person.status === "正常"}" data-drag-staff="${person.id}" title="#${escapeHtml(person.id)} ${escapeHtml(person.status)}"><i class="bi bi-grip-vertical"></i><span>${escapeHtml(person.name)}</span></div>`).join("")}</div>
      </aside>
      <div class="schedule-board" style="--flight-count:${Math.max(1, flights.length)}">
        ${flights.map((flight) => {
          const assignments = state.assignments.filter((item) => item.flightId === flight.id);
          const regularAssignments = assignments.filter((item) => state.positionRules.find((rule) => rule.id === item.positionRuleId)?.category !== "支援" && item.positionRuleId);
          const supportAssignments = assignments.filter((item) => !item.positionRuleId || state.positionRules.find((rule) => rule.id === item.positionRuleId)?.category === "支援");
          return `<section class="flight-column"><header class="flight-column-head"><div><strong>${escapeHtml(flight.flightNo)}</strong><span>${escapeHtml(flight.startTime)}–${escapeHtml(flight.endTime)}</span>${flight.remark ? `<small>${escapeHtml(flight.remark)}</small>` : ""}</div><button class="btn btn-sm btn-outline-primary icon-btn" type="button" data-action="add-schedule-slot" data-id="${flight.id}" title="增加临时支援岗位"><i class="bi bi-person-plus"></i></button></header><div class="flight-column-cells">${regularAssignments.map((item) => assignmentCell(state, item)).join("")}${supportAssignments.length ? `<div class="support-divider"><span>支援岗位</span></div>${supportAssignments.map((item) => assignmentCell(state, item)).join("")}` : ""}</div></section>`;
        }).join("")}
      </div>
    </section>
    <datalist id="schedule-staff-names">${state.staff.filter((person) => person.status === "正常").map((person) => `<option value="${escapeHtml(person.name)}"></option>`).join("")}</datalist>
    <details class="workspace-section load-details"><summary>人员负荷与疲劳</summary><div class="table-responsive mt-3"><table class="table table-sm align-middle data-table"><thead><tr><th>人员</th><th>状态</th><th>当日工时</th><th>岗位疲劳</th><th>历史疲劳</th><th>总疲劳</th></tr></thead><tbody>
      ${loads.map((load) => `<tr><td>${escapeHtml(load.staff.name)}</td><td>${escapeHtml(load.staff.status)}</td><td>${load.workHours.toFixed(1)}h</td><td>${load.todayFatigue.toFixed(1)}</td><td>${load.historyFatigue.toFixed(1)}</td><td><span class="badge ${load.totalFatigue >= 20 ? "text-bg-danger" : load.totalFatigue >= 10 ? "text-bg-warning" : "text-bg-success"}">${load.totalFatigue.toFixed(1)}</span></td></tr>`).join("")}
    </tbody></table></div></details>`;
}
