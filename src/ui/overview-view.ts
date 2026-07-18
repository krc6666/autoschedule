import type { AppState } from "../model";
import { buildStaffLoads } from "../domain/fatigue";
import { escapeHtml } from "../utils";

export function renderOverview(state: AppState, date: string): string {
  const available = state.staff.filter((person) => person.status === "正常").length;
  const assigned = state.assignments.filter((item) => item.status === "assigned").length;
  const unfilled = state.assignments.length - assigned;
  const loads = buildStaffLoads(state.staff, state.assignments, state.history, date, state.settings)
    .filter((item) => item.workHours > 0 || item.historyFatigue > 0)
    .sort((left, right) => right.totalFatigue - left.totalFatigue)
    .slice(0, 8);
  const missingRules = state.flights.flatMap((flight) => flight.positions.map((position) => ({ flight, position })))
    .filter(({ flight, position }) => !state.positionRules.some((rule) => rule.flightNo === flight.flightNo && rule.name === position));

  return `
    <section class="metric-grid" aria-label="排班概况">
      <article class="metric"><span class="metric-icon text-primary"><i class="bi bi-airplane"></i></span><div><strong>${state.flights.length}</strong><span>今日航班</span></div></article>
      <article class="metric"><span class="metric-icon text-success"><i class="bi bi-people"></i></span><div><strong>${available}</strong><span>可用人员</span></div></article>
      <article class="metric"><span class="metric-icon text-info"><i class="bi bi-person-check"></i></span><div><strong>${assigned}</strong><span>已排岗位</span></div></article>
      <article class="metric ${unfilled ? "metric-alert" : ""}"><span class="metric-icon text-danger"><i class="bi bi-exclamation-diamond"></i></span><div><strong>${unfilled}</strong><span>待补岗位</span></div></article>
    </section>
    <section class="workspace-section">
      <div class="section-heading"><div><h3>航班运行面板</h3><span>${escapeHtml(date)}</span></div><button class="btn btn-primary" type="button" data-action="generate-schedule"><i class="bi bi-stars me-2"></i>生成排班</button></div>
      <div class="flight-strip">
        ${state.flights.length ? [...state.flights].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((flight) => {
          const own = state.assignments.filter((item) => item.flightId === flight.id);
          const done = own.filter((item) => item.status === "assigned").length;
          return `<button class="flight-stop" type="button" data-nav="schedule">
            <span class="flight-time">${escapeHtml(flight.startTime)}</span>
            <span class="flight-dot ${own.length && done === own.length ? "done" : own.length ? "warning" : ""}"></span>
            <strong>${escapeHtml(flight.flightNo)}</strong>
            <small>${done}/${flight.positions.length} 岗</small>
          </button>`;
        }).join("") : `<div class="empty-state"><i class="bi bi-airplane"></i><span>尚无航班</span></div>`}
      </div>
    </section>
    <section class="workspace-section split-section">
      <div>
        <div class="section-heading"><h3>疲劳负荷</h3><button class="btn btn-sm btn-outline-secondary" type="button" data-nav="schedule">查看全部</button></div>
        <div class="table-responsive">
          <table class="table table-sm align-middle mb-0"><thead><tr><th>人员</th><th>当日工时</th><th>历史</th><th>总疲劳</th></tr></thead><tbody>
            ${loads.length ? loads.map((load) => `<tr><td>${escapeHtml(load.staff.name)}</td><td>${load.workHours.toFixed(1)}h</td><td>${load.historyFatigue.toFixed(1)}</td><td><span class="badge ${load.totalFatigue >= 20 ? "text-bg-danger" : load.totalFatigue >= 10 ? "text-bg-warning" : "text-bg-success"}">${load.totalFatigue.toFixed(1)}</span></td></tr>`).join("") : `<tr><td colspan="4" class="empty-cell">暂无负荷数据</td></tr>`}
          </tbody></table>
        </div>
      </div>
      <div>
        <div class="section-heading"><h3>配置健康</h3><button class="btn btn-sm btn-outline-secondary" type="button" data-nav="config">检查配置</button></div>
        <div class="health-list">
          <div><i class="bi ${missingRules.length ? "bi-x-circle-fill text-danger" : "bi-check-circle-fill text-success"}"></i><span>岗位规则</span><strong>${missingRules.length ? `${missingRules.length} 项缺失` : "完整"}</strong></div>
          <div><i class="bi ${state.staff.some((item) => !item.name) ? "bi-x-circle-fill text-danger" : "bi-check-circle-fill text-success"}"></i><span>人员信息</span><strong>${state.staff.length} 人</strong></div>
          <div><i class="bi ${state.positionRules.some((item) => !item.manual && item.qualifiedStaffIds.length === 0) ? "bi-exclamation-circle-fill text-warning" : "bi-check-circle-fill text-success"}"></i><span>岗位资质</span><strong>${state.positionRules.length} 条</strong></div>
          <div><i class="bi bi-check-circle-fill text-success"></i><span>本地存储</span><strong>已启用</strong></div>
        </div>
      </div>
    </section>`;
}
