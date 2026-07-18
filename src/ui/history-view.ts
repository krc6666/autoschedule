import type { AppState } from "../model";
import { escapeHtml } from "../utils";

export function renderHistory(state: AppState): string {
  const dates = [...new Set(state.history.map((item) => item.date))].sort().reverse();
  return `<section class="workspace-section">
    <div class="section-heading"><div><h3>历史排班与疲劳负荷</h3><span>${dates.length} 个工作日 · ${state.history.length} 条记录；导入昨天的“排班结果”即可参与下一次自动排班</span></div><div class="d-flex gap-2"><button class="btn btn-outline-secondary" type="button" data-action="import-history"><i class="bi bi-file-earmark-arrow-up me-2"></i>导入历史排班结果</button><button class="btn btn-outline-danger" type="button" data-action="clear-history"><i class="bi bi-trash3 me-2"></i>清空历史</button></div></div>
    ${dates.length ? dates.map((date) => {
      const records = state.history.filter((item) => item.date === date);
      return `<div class="history-group"><div class="history-date"><strong>${escapeHtml(date)}</strong><span>${records.length} 条</span></div><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>航班</th><th>岗位</th><th>人员</th><th>时段</th><th>工时</th><th>疲劳点</th><th>备注</th><th class="action-col"></th></tr></thead><tbody>
        ${records.map((record) => `<tr><td>${escapeHtml(record.flightNo || "-")}</td><td>${escapeHtml(record.position)}</td><td>${escapeHtml(record.staffName)}</td><td>${escapeHtml(record.startTime && record.endTime ? `${record.startTime}–${record.endTime}` : "-")}</td><td>${record.workHours.toFixed(1)}h</td><td>${record.fatiguePoints.toFixed(1)}</td><td class="text-secondary">${escapeHtml(record.remark)}</td><td><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="delete-history" data-id="${record.id}" title="删除记录"><i class="bi bi-trash3"></i></button></td></tr>`).join("")}
      </tbody></table></div></div>`;
    }).join("") : `<div class="empty-workspace"><i class="bi bi-clock-history"></i><h3>暂无历史记录</h3></div>`}
  </section>`;
}
