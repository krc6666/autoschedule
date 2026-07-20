import type { AppSection, AppState } from "../model";
import { escapeHtml } from "../utils";

const navigation: Array<{ id: AppSection; label: string; icon: string }> = [
  { id: "overview", label: "总览", icon: "speedometer2" },
  { id: "config", label: "配置", icon: "sliders" },
  { id: "flights", label: "航班", icon: "airplane" },
  { id: "schedule", label: "排班", icon: "calendar2-check" },
  { id: "policy", label: "策略", icon: "diagram-3" },
  { id: "history", label: "历史", icon: "clock-history" }
];

export function renderShell(state: AppState, active: AppSection, date: string, content: string): string {
  const assigned = state.assignments.filter((item) => item.status === "assigned").length;
  const unfilled = state.assignments.filter((item) => item.status === "unfilled").length;
  return `
    <header class="app-header border-bottom bg-white sticky-top">
      <div class="container-fluid app-container d-flex align-items-center gap-3 py-2">
        <div class="brand-mark" aria-hidden="true"><i class="bi bi-calendar2-week"></i></div>
        <div class="me-auto min-w-0">
          <h1 class="h5 mb-0 text-truncate">自动排班</h1>
          <div class="small text-secondary">机场地勤 · 本地工作台</div>
        </div>
        <label class="date-control d-flex align-items-center gap-2">
          <i class="bi bi-calendar3 text-secondary"></i>
          <input class="form-control form-control-sm" id="schedule-date" type="date" value="${escapeHtml(date)}" aria-label="排班日期">
        </label>
        <span class="save-state small text-secondary d-none d-md-inline" id="save-state"><i class="bi bi-check-circle me-1"></i>已保存</span>
      </div>
    </header>
    <div class="container-fluid app-container app-layout">
      <nav class="app-nav" aria-label="主要导航">
        ${navigation.map((item) => `
          <button class="nav-item ${active === item.id ? "active" : ""}" type="button" data-nav="${item.id}" title="${item.label}">
            <i class="bi bi-${item.icon}"></i><span>${item.label}</span>
          </button>`).join("")}
        <div class="nav-spacer"></div>
        <button class="nav-item" type="button" data-action="import-workbook" title="导入配置、航班计划或历史排班结果">
          <i class="bi bi-file-earmark-arrow-up"></i><span>导入数据</span>
        </button>
        <button class="nav-item" type="button" data-action="export-config" title="导出配置">
          <i class="bi bi-file-earmark-arrow-down"></i><span>导出配置</span>
        </button>
      </nav>
      <main class="app-main">
        <div class="content-head d-flex align-items-center justify-content-between gap-3">
          <div>
            <h2 class="h4 mb-1">${navigation.find((item) => item.id === active)?.label ?? "工作台"}</h2>
            <div class="small text-secondary">${state.flights.length} 个航班 · ${state.staff.filter((person) => person.status === "正常").length} 人可用 · ${assigned} 个岗位已排${unfilled ? ` · <span class="text-danger">${unfilled} 个待补位</span>` : ""}</div>
          </div>
          <div class="content-actions" id="content-actions"></div>
        </div>
        <div id="view-root">${content}</div>
      </main>
    </div>
    <input class="visually-hidden" id="workbook-input" type="file" accept=".xlsx,.xls">
    <div class="toast-container position-fixed bottom-0 end-0 p-3">
      <div class="toast align-items-center border-0" id="app-toast" role="status" aria-live="polite" aria-atomic="true">
        <div class="d-flex"><div class="toast-body" id="toast-body"></div><button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="关闭"></button></div>
      </div>
    </div>
    <div class="modal fade" id="app-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">
        <div class="modal-header"><h2 class="modal-title fs-5" id="modal-title"></h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button></div>
        <div class="modal-body" id="modal-body"></div>
        <div class="modal-footer" id="modal-footer"></div>
      </div></div>
    </div>`;
}
