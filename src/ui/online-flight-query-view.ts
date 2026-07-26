import { buildFlightPlanReconciliation } from "../domain/flight-plan-reconciliation";
import type { OnlineFlightQueryResult } from "../infrastructure/flight-query";
import type { AppState } from "../model";
import { escapeHtml } from "../utils";

function onlineRows(state: AppState, currentScheduleDate: string, result: OnlineFlightQueryResult): string {
  const reconciliation = buildFlightPlanReconciliation(state, currentScheduleDate, result);
  if (!reconciliation.onlineFlights.length) {
    return `<tr><td colspan="7" class="empty-cell">没有查询到符合条件的国际或地区航班</td></tr>`;
  }
  return reconciliation.onlineFlights.map(({ flight, template, currentFlight }) => {
    const status = currentFlight ? "继续保留" : template ? "建议新增" : "缺少同名模板";
    const statusStyle = currentFlight ? "text-bg-light" : template ? "text-bg-success" : "text-bg-warning";
    return `<tr>
      <td><input class="form-check-input" type="checkbox" name="online-flight-addition" value="${escapeHtml(flight.key)}" data-template-id="${escapeHtml(template?.id ?? "")}" ${template && !currentFlight ? "checked" : ""} ${!template || currentFlight ? "disabled" : ""} aria-label="新增 ${escapeHtml(flight.flightNo)}"></td>
      <td><strong>${escapeHtml(flight.flightNo)}</strong><small class="d-block text-secondary">${escapeHtml(flight.date)}</small></td>
      <td>${escapeHtml(flight.departureTime)}</td>
      <td><strong>${escapeHtml(flight.destination)}</strong><small class="d-block text-secondary">${escapeHtml(flight.destinationCity)}</small></td>
      <td>${escapeHtml(flight.country)}</td>
      <td>${template ? `<strong>${escapeHtml(template.flightNo)}</strong><small class="d-block text-secondary">保障 ${escapeHtml(template.startTime)}–${escapeHtml(template.endTime)}</small>` : `<span class="text-secondary">未匹配</span>`}</td>
      <td><span class="badge ${statusStyle}">${status}</span></td>
    </tr>`;
  }).join("");
}

function removalRows(state: AppState, currentScheduleDate: string, result: OnlineFlightQueryResult): string {
  const reconciliation = buildFlightPlanReconciliation(state, currentScheduleDate, result);
  if (!reconciliation.removals.length) {
    return `<tr><td colspan="5" class="empty-cell online-flight-query-empty">当前计划没有待删航班</td></tr>`;
  }
  return reconciliation.removals.map((flight) => `<tr>
    <td><input class="form-check-input" type="checkbox" name="online-flight-removal" value="${escapeHtml(flight.id)}" ${reconciliation.removalAllowed ? "" : "disabled"} aria-label="删除 ${escapeHtml(flight.flightNo)}"></td>
    <td><strong>${escapeHtml(flight.flightNo)}</strong></td>
    <td>${escapeHtml(flight.startTime)}–${escapeHtml(flight.endTime)}</td>
    <td>${flight.bookedPassengers}</td>
    <td><span class="badge text-bg-warning">待确认删减</span></td>
  </tr>`).join("");
}

export function renderOnlineFlightQuery(
  state: AppState,
  currentScheduleDate: string,
  queryDate: string,
  result: OnlineFlightQueryResult | null
): string {
  const reconciliation = result ? buildFlightPlanReconciliation(state, currentScheduleDate, result) : null;
  return `<div class="online-flight-query">
    <div class="online-flight-query-form">
      <label class="form-label">查询日期<input class="form-control" id="online-flight-query-date" type="date" value="${escapeHtml(queryDate)}"></label>
      <button class="btn btn-primary" type="button" data-action="run-online-flight-query"><i class="bi bi-search me-2"></i>查询该日期</button>
    </div>
    <p class="online-flight-query-note">工作日边界：排除当日 00:00–06:00，纳入次日 00:00–06:00。计划起飞时间只用于核对，新增航班的保障时段和岗位来自同名模板。</p>
    ${result && reconciliation ? `<div class="online-flight-reconciliation-summary">
        <span>继续保留 <strong>${reconciliation.retained.length}</strong></span>
        <span>建议新增 <strong>${reconciliation.additions.length}</strong></span>
        <span>待确认删减 <strong>${reconciliation.removals.length}</strong></span>
        <small>数据时间 ${escapeHtml(new Date(result.fetchedAt).toLocaleString("zh-CN"))}</small>
      </div>
      ${reconciliation.removalBlockedReason ? `<div class="alert alert-warning py-2" role="alert">${escapeHtml(reconciliation.removalBlockedReason)}</div>` : ""}
      <section class="online-flight-query-section"><h4>线上查询结果</h4>
        <div class="table-responsive"><table class="table align-middle data-table online-flight-query-table"><thead><tr><th>新增</th><th>航班</th><th>计划起飞</th><th>目的地</th><th>国家/地区</th><th>排班模板</th><th>对账结果</th></tr></thead><tbody>${onlineRows(state, currentScheduleDate, result)}</tbody></table></div>
      </section>
      <section class="online-flight-query-section"><div class="online-flight-query-section-heading"><h4>待确认删减</h4><small>线上未查到不代表停飞，默认不选择，确认后才会删除。</small></div>
        <div class="table-responsive"><table class="table align-middle data-table online-flight-query-table"><thead><tr><th>删除</th><th>当前航班</th><th>保障时段</th><th>预定人数</th><th>对账结果</th></tr></thead><tbody>${removalRows(state, currentScheduleDate, result)}</tbody></table></div>
      </section>
      <div class="d-flex justify-content-end"><button class="btn btn-primary" type="button" data-action="apply-flight-plan-reconciliation"><i class="bi bi-check2-square me-2"></i>应用航班计划对账</button></div>`
      : `<div class="empty-state">选择日期后查询在线航班计划</div>`}
  </div>`;
}
