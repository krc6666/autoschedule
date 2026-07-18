import type { AppState, Assignment } from "../model";
import { buildStaffLoads } from "../domain/fatigue";
import { isNightInterval } from "../domain/time";
import { escapeHtml } from "../utils";

function staffOptions(state: AppState, assignment: Assignment): string {
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  const night = isNightInterval(assignment.startTime, assignment.endTime, state.settings.nightStart, state.settings.nightEnd);
  return [`<option value="">待补位</option>`, ...state.staff.map((person) => {
    const disallowed = person.status !== "正常" || (night && !person.nightShift) || Boolean(rule && !rule.manual && !rule.qualifiedStaffIds.includes(person.id));
    const suffix = person.status !== "正常" ? ` · ${person.status}` : night && !person.nightShift ? " · 不可夜班" : rule && !rule.manual && !rule.qualifiedStaffIds.includes(person.id) ? " · 无资质" : "";
    return `<option value="${escapeHtml(person.id)}" ${assignment.staffId === person.id ? "selected" : ""} ${disallowed ? "disabled" : ""}>${escapeHtml(person.name + suffix)}</option>`;
  })].join("");
}

export function renderSchedule(state: AppState, date: string): string {
  if (!state.assignments.length) {
    return `<section class="workspace-section empty-workspace"><i class="bi bi-calendar2-plus"></i><h3>尚未生成排班</h3><button class="btn btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-stars me-2"></i>生成排班</button></section>`;
  }
  const loads = buildStaffLoads(state.staff, state.assignments, state.history, date, state.settings)
    .sort((left, right) => right.totalFatigue - left.totalFatigue);
  return `
    <section class="toolbar-band"><div class="d-flex gap-2 flex-wrap"><button class="btn btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-arrow-repeat me-2"></i>重新排班</button><button class="btn btn-outline-success" type="button" data-action="export-schedule"><i class="bi bi-file-earmark-excel me-2"></i>Excel</button><button class="btn btn-outline-primary" type="button" data-action="export-share-html"><i class="bi bi-filetype-html me-2"></i>HTML</button><button class="btn btn-outline-primary" type="button" data-action="export-share-png"><i class="bi bi-file-earmark-image me-2"></i>图片</button><button class="btn btn-outline-secondary" type="button" data-action="archive-schedule"><i class="bi bi-archive me-2"></i>归档</button><button class="btn btn-outline-danger" type="button" data-action="clear-schedule"><i class="bi bi-x-circle me-2"></i>清空</button></div><span class="small text-secondary">${escapeHtml(date)}</span></section>
    ${state.flights.map((flight) => {
      const assignments = state.assignments.filter((item) => item.flightId === flight.id);
      const done = assignments.filter((item) => item.status === "assigned").length;
      return `<section class="workspace-section flight-section">
        <div class="flight-heading"><div><span class="flight-number">${escapeHtml(flight.flightNo)}</span><span>${escapeHtml(flight.startTime)}–${escapeHtml(flight.endTime)}</span><span class="text-secondary">${escapeHtml(flight.remark)}</span></div><span class="badge ${done === assignments.length ? "text-bg-success" : "text-bg-warning"}">${done}/${assignments.length}</span></div>
        <div class="table-responsive"><table class="table align-middle mb-0 schedule-table"><thead><tr><th>岗位</th><th>人员</th><th>工时</th><th>疲劳点</th><th>备注</th><th>状态</th></tr></thead><tbody>
          ${assignments.map((assignment) => `<tr class="${assignment.status !== "assigned" ? "table-warning" : ""}"><td><strong>${escapeHtml(assignment.position)}</strong></td><td><select class="form-select form-select-sm staff-assignment-select" data-action="assign-staff" data-id="${assignment.id}">${staffOptions(state, assignment)}</select></td><td>${assignment.workHours.toFixed(1)}h</td><td>${assignment.fatiguePoints.toFixed(1)}</td><td class="text-secondary">${escapeHtml(assignment.remark)}</td><td>${assignment.status === "assigned" ? `<span class="status-dot success"></span>已排` : assignment.status === "manual" ? `<span class="status-dot info"></span>手动` : `<span class="status-dot warning"></span>待补`}</td></tr>`).join("")}
        </tbody></table></div>
      </section>`;
    }).join("")}
    <section class="workspace-section"><div class="section-heading"><h3>人员负荷</h3><span>当日与历史疲劳合计</span></div><div class="table-responsive"><table class="table table-sm align-middle data-table"><thead><tr><th>人员</th><th>状态</th><th>当日工时</th><th>岗位疲劳</th><th>历史疲劳</th><th>总疲劳</th></tr></thead><tbody>
      ${loads.map((load) => `<tr><td>${escapeHtml(load.staff.name)}</td><td>${escapeHtml(load.staff.status)}</td><td>${load.workHours.toFixed(1)}h</td><td>${load.todayFatigue.toFixed(1)}</td><td>${load.historyFatigue.toFixed(1)}</td><td><span class="badge ${load.totalFatigue >= 20 ? "text-bg-danger" : load.totalFatigue >= 10 ? "text-bg-warning" : "text-bg-success"}">${load.totalFatigue.toFixed(1)}</span></td></tr>`).join("")}
    </tbody></table></div></section>`;
}
