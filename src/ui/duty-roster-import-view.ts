import type { DutyRosterImportPreview } from "../infrastructure/duty-roster-excel";
import type { AppState } from "../model";
import { escapeHtml } from "../utils";

function name(state: AppState, id: string | null): string {
  return id ? state.staff.find((person) => person.id === id)?.name ?? `#${id}` : "未配置";
}

export function renderDutyRosterImportPreview(state: AppState, preview: DutyRosterImportPreview): string {
  const messages = [
    ...preview.errors.map((message) => `<div class="alert alert-danger py-2 mb-2"><i class="bi bi-x-circle me-2"></i>${escapeHtml(message)}</div>`),
    ...preview.warnings.map((message) => `<div class="alert alert-warning py-2 mb-2"><i class="bi bi-exclamation-triangle me-2"></i>${escapeHtml(message)}</div>`)
  ].join("");
  return `<div class="duty-roster-import-preview">
    <div class="duty-import-summary"><span>目标月份 <strong>${escapeHtml(preview.month)}</strong></span><span>识别安排 <strong>${preview.recognizedAssignments}</strong> 项</span><span>值班/备勤将整月替换，CX航前保持不变</span></div>
    ${messages}
    <div class="table-responsive"><table class="table table-sm align-middle data-table"><thead><tr><th>工作班日期</th><th>值班人员</th><th>次日备勤日期</th><th>次日备勤一</th><th>次日备勤二</th></tr></thead><tbody>
      ${preview.rows.map((row) => `<tr><td><strong>${escapeHtml(row.date)}</strong></td><td>${row.dutyIncluded === false ? `<span class="text-secondary">本表未覆盖，保持原值</span>` : escapeHtml(name(state, row.dutyStaffId))}</td><td>${escapeHtml(row.standbyDate)}</td><td colspan="${row.standbyIncluded === false ? 2 : 1}">${row.standbyIncluded === false ? `<span class="text-secondary">本表未覆盖，保持原值</span>` : escapeHtml(name(state, row.standbyStaffIds[0]))}</td>${row.standbyIncluded === false ? "" : `<td>${escapeHtml(name(state, row.standbyStaffIds[1]))}</td>`}</tr>`).join("")}
    </tbody></table></div>
  </div>`;
}
