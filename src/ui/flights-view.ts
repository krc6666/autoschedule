import type { AppState } from "../model";
import { escapeHtml } from "../utils";

export function renderFlights(state: AppState): string {
  return `<section class="workspace-section">
    <div class="section-heading"><div><h3>当日航班计划</h3><span>输入航班号会自动带出配置模板；预定人数决定启用多少岗位</span></div><div class="d-flex gap-2"><button class="btn btn-outline-secondary" type="button" data-action="add-from-template"><i class="bi bi-copy me-2"></i>选择模板</button><button class="btn btn-primary" type="button" data-action="add-flight"><i class="bi bi-plus-lg me-2"></i>新增当日航班</button></div></div>
    <div class="table-responsive">
      <table class="table align-middle data-table"><thead><tr><th>航班号</th><th>时间</th><th>预定人数（运力）</th><th>岗位清单</th><th>备注</th><th class="action-col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>
        ${state.flights.length ? [...state.flights].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((flight) => `<tr>
          <td><input class="form-control form-control-sm code-input" list="flight-template-options" placeholder="如 CX937" value="${escapeHtml(flight.flightNo)}" data-entity="flight" data-id="${flight.id}" data-field="flightNo" aria-label="航班号"></td>
          <td><div class="time-range"><input class="form-control form-control-sm" type="time" value="${escapeHtml(flight.startTime)}" data-entity="flight" data-id="${flight.id}" data-field="startTime" aria-label="开始时间"><span>至</span><input class="form-control form-control-sm" type="time" value="${escapeHtml(flight.endTime)}" data-entity="flight" data-id="${flight.id}" data-field="endTime" aria-label="结束时间"></div></td>
          <td><input class="form-control form-control-sm number-input" type="number" min="0" value="${flight.bookedPassengers}" data-entity="flight" data-id="${flight.id}" data-field="bookedPassengers" aria-label="预定人数"></td>
          <td><input class="form-control form-control-sm wide-input" value="${escapeHtml(flight.positions.join(", "))}" data-entity="flight" data-id="${flight.id}" data-field="positions" aria-label="涉及岗位"></td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(flight.remark)}" data-entity="flight" data-id="${flight.id}" data-field="remark" aria-label="备注"></td>
          <td><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="delete-flight" data-id="${flight.id}" title="删除航班"><i class="bi bi-trash3"></i></button></td>
        </tr>`).join("") : `<tr><td colspan="6" class="empty-cell">尚无航班计划</td></tr>`}
      </tbody></table>
    </div>
    <datalist id="flight-template-options">${state.templates.map((template) => `<option value="${escapeHtml(template.flightNo)}">${escapeHtml(template.startTime)}–${escapeHtml(template.endTime)}</option>`).join("")}</datalist>
  </section>`;
}
