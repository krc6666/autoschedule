import type { AppState } from "../model";
import { escapeHtml } from "../utils";

function names(state: AppState, ids: string[]): string {
  const result = ids.map((id) => state.staff.find((person) => person.id === id)?.name ?? `#${id}`);
  return result.length ? result.join("、") : "未配置";
}

export function renderConfig(state: AppState): string {
  return `
    <section class="workspace-section">
      <div class="section-heading"><div><h3>人员信息</h3><span>${state.staff.length} 人 · ${state.staff.filter((item) => item.status !== "正常").length} 人不可用</span></div><div class="d-flex gap-2"><a class="btn btn-outline-secondary" href="./template/排班工具配置模板.xlsx" download><i class="bi bi-download me-2"></i>配置模板</a><button class="btn btn-primary" type="button" data-action="add-staff"><i class="bi bi-person-plus me-2"></i>新增人员</button></div></div>
      <div class="table-responsive"><table class="table align-middle data-table"><thead><tr><th>编号</th><th>姓名</th><th>夜班</th><th>状态</th><th>备注</th><th class="action-col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>
        ${state.staff.map((person) => `<tr>
          <td><input class="form-control form-control-sm code-input" value="${escapeHtml(person.id)}" data-entity="staff" data-id="${person.id}" data-field="id" aria-label="编号"></td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(person.name)}" data-entity="staff" data-id="${person.id}" data-field="name" aria-label="姓名"></td>
          <td><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" ${person.nightShift ? "checked" : ""} data-entity="staff" data-id="${person.id}" data-field="nightShift" aria-label="可上夜班"></div></td>
          <td><select class="form-select form-select-sm" data-entity="staff" data-id="${person.id}" data-field="status" aria-label="状态">${["正常", "病假", "休假"].map((status) => `<option ${status === person.status ? "selected" : ""}>${status}</option>`).join("")}</select></td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(person.remark)}" data-entity="staff" data-id="${person.id}" data-field="remark" aria-label="备注"></td>
          <td><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="delete-staff" data-id="${person.id}" title="删除人员"><i class="bi bi-trash3"></i></button></td>
        </tr>`).join("")}
      </tbody></table></div>
    </section>
    <section class="workspace-section">
      <div class="section-heading"><div><h3>岗位规则</h3><span>${state.positionRules.length} 条规则</span></div><button class="btn btn-primary" type="button" data-action="add-position"><i class="bi bi-plus-lg me-2"></i>新增规则</button></div>
      <div class="table-responsive"><table class="table align-middle data-table"><thead><tr><th>航班</th><th>岗位</th><th>分类</th><th>疲劳点</th><th>资质人员</th><th>备注</th><th class="action-col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>
        ${state.positionRules.map((rule) => `<tr>
          <td><input class="form-control form-control-sm code-input" value="${escapeHtml(rule.flightNo)}" data-entity="position" data-id="${rule.id}" data-field="flightNo" aria-label="航班号"></td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(rule.name)}" data-entity="position" data-id="${rule.id}" data-field="name" aria-label="岗位名称"></td>
          <td><select class="form-select form-select-sm" data-entity="position" data-id="${rule.id}" data-field="category" aria-label="分类"><option ${rule.category === "常规" ? "selected" : ""}>常规</option><option ${rule.category === "支援" ? "selected" : ""}>支援</option></select></td>
          <td><input class="form-control form-control-sm number-input" type="number" min="0" step="0.5" value="${rule.fatiguePoints}" data-entity="position" data-id="${rule.id}" data-field="fatiguePoints" aria-label="疲劳点数"></td>
          <td><button class="qualified-button" type="button" data-action="edit-qualified" data-id="${rule.id}"><span>${rule.manual ? "手动补位" : escapeHtml(names(state, rule.qualifiedStaffIds))}</span><i class="bi bi-chevron-right"></i></button></td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(rule.remark)}" data-entity="position" data-id="${rule.id}" data-field="remark" aria-label="备注"></td>
          <td><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="delete-position" data-id="${rule.id}" title="删除规则"><i class="bi bi-trash3"></i></button></td>
        </tr>`).join("")}
      </tbody></table></div>
    </section>
    <section class="workspace-section split-section settings-section">
      <div>
        <div class="section-heading"><h3>排班约束</h3></div>
        <div class="form-grid">
          <label class="form-label">每日工时上限<input class="form-control" type="number" min="1" max="24" step="0.5" value="${state.settings.maxDailyHours}" data-entity="settings" data-field="maxDailyHours"></label>
          <label class="form-label">历史统计天数<input class="form-control" type="number" min="1" max="90" value="${state.settings.historyWindowDays}" data-entity="settings" data-field="historyWindowDays"></label>
          <label class="form-label">连续工作惩罚<input class="form-control" type="number" min="0" step="0.5" value="${state.settings.consecutiveDayPenalty}" data-entity="settings" data-field="consecutiveDayPenalty"></label>
          <label class="form-label">夜班疲劳倍数<input class="form-control" type="number" min="1" step="0.5" value="${state.settings.nightMultiplier}" data-entity="settings" data-field="nightMultiplier"></label>
        </div>
      </div>
      <div>
        <div class="section-heading"><div><h3>航班模板</h3><span>${state.templates.length} 个</span></div></div>
        <div class="template-list">${state.templates.map((template) => `<div><span class="template-code">${escapeHtml(template.flightNo)}</span><span>${escapeHtml(template.startTime)}–${escapeHtml(template.endTime)}</span><small>${template.positions.length} 岗</small><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="delete-template" data-id="${template.id}" title="删除模板"><i class="bi bi-trash3"></i></button></div>`).join("") || `<div class="empty-state">尚无模板</div>`}</div>
        <button class="btn btn-outline-secondary mt-3" type="button" data-action="save-flights-as-templates"><i class="bi bi-bookmark-plus me-2"></i>以当前航班更新模板</button>
      </div>
    </section>`;
}
