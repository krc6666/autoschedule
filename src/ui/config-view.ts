import type { AppState } from "../model";
import { escapeHtml } from "../utils";

function names(state: AppState, ids: string[]): string {
  const result = ids.map((id) => state.staff.find((person) => person.id === id)?.name ?? `#${id}`);
  return result.length ? result.join("、") : "未配置";
}

export function renderConfig(state: AppState): string {
  const flightNumbers = [...new Set([
    ...state.templates.map((item) => item.flightNo),
    ...state.flights.map((item) => item.flightNo),
    ...state.positionRules.map((item) => item.flightNo)
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const positionGroups = flightNumbers
    .map((flightNo) => ({ flightNo, rules: state.positionRules.filter((rule) => rule.flightNo === flightNo) }))
    .filter((group) => group.rules.length);
  return `
    <details class="workspace-section config-collapsible" data-config-section="staff">
      <summary><span><strong>人员信息</strong><small>${state.staff.length} 人 · ${state.staff.filter((item) => item.staffType === "常规" && item.teamLeader).length} 人分队长 · ${state.staff.filter((item) => item.staffType === "常规" && item.dutyQualified).length} 人值班资质 · ${state.staff.filter((item) => item.staffType === "行政支援").length} 人行政支援 · ${state.staff.filter((item) => item.status !== "正常").length} 人不可用</small></span><i class="bi bi-chevron-down"></i></summary>
      <div class="config-collapsible-content"><div class="config-collapsible-toolbar"><button class="btn btn-outline-secondary" type="button" data-action="import-config"><i class="bi bi-file-earmark-arrow-up me-2"></i>导入配置模板</button><a class="btn btn-outline-secondary" href="./template/排班工具配置模板.xlsx" download><i class="bi bi-download me-2"></i>下载模板</a><button class="btn btn-primary" type="button" data-action="add-staff"><i class="bi bi-person-plus me-2"></i>新增人员</button></div>
      <div class="table-responsive"><table class="table align-middle data-table"><thead><tr><th>编号</th><th>姓名</th><th>人员类型</th><th>分队长</th><th>CX航前资质</th><th>值班资质</th><th>夜班</th><th>状态</th><th>备注</th><th class="action-col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>
        ${state.staff.map((person) => `<tr>
          <td><input class="form-control form-control-sm code-input" value="${escapeHtml(person.id)}" data-entity="staff" data-id="${person.id}" data-field="id" aria-label="编号"></td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(person.name)}" data-entity="staff" data-id="${person.id}" data-field="name" aria-label="姓名"></td>
          <td><select class="form-select form-select-sm" data-entity="staff" data-id="${person.id}" data-field="staffType" aria-label="人员类型"><option ${person.staffType === "常规" ? "selected" : ""}>常规</option><option ${person.staffType === "行政支援" ? "selected" : ""}>行政支援</option></select></td>
          <td><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" ${person.teamLeader ? "checked" : ""} ${person.staffType === "行政支援" ? "disabled" : ""} data-entity="staff" data-id="${person.id}" data-field="teamLeader" aria-label="是否为分队长"></div></td>
          <td><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" ${person.cxPreflightQualified ? "checked" : ""} ${person.staffType === "行政支援" ? "disabled" : ""} data-entity="staff" data-id="${person.id}" data-field="cxPreflightQualified" aria-label="CX航前资质"></div></td>
          <td><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" ${person.dutyQualified ? "checked" : ""} ${person.staffType === "行政支援" ? "disabled" : ""} data-entity="staff" data-id="${person.id}" data-field="dutyQualified" aria-label="值班资质"></div></td>
          <td><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" ${person.nightShift ? "checked" : ""} data-entity="staff" data-id="${person.id}" data-field="nightShift" aria-label="可上夜班"></div></td>
          <td><select class="form-select form-select-sm" data-entity="staff" data-id="${person.id}" data-field="status" aria-label="状态">${["正常", "病假", "休假"].map((status) => `<option ${status === person.status ? "selected" : ""}>${status}</option>`).join("")}</select></td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(person.remark)}" data-entity="staff" data-id="${person.id}" data-field="remark" aria-label="备注"></td>
          <td><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="delete-staff" data-id="${person.id}" title="删除人员"><i class="bi bi-trash3"></i></button></td>
        </tr>`).join("")}
      </tbody></table></div></div>
    </details>
    <section class="workspace-section">
      <div class="section-heading"><div><h3>岗位规则</h3><span>${state.positionRules.length} 条规则 · 按航班折叠</span></div><div class="position-batch-controls"><select class="form-select form-select-sm" id="position-flight" aria-label="新增规则所属航班">${flightNumbers.map((flightNo) => `<option>${escapeHtml(flightNo)}</option>`).join("")}</select><input class="form-control form-control-sm" id="position-batch-count" type="number" min="1" max="30" value="5" aria-label="新增规则数量"><button class="btn btn-primary btn-sm" type="button" data-action="add-positions"><i class="bi bi-plus-lg me-1"></i>批量新增</button></div></div>
      <div class="position-rule-groups">${positionGroups.map(({ flightNo, rules }) => {
        const regularCount = rules.filter((rule) => rule.category === "常规").length;
        const guideCount = rules.filter((rule) => rule.category === "引导").length;
        const supervisorCount = rules.filter((rule) => rule.category === "机动督导").length;
        const diversionCount = rules.filter((rule) => rule.category === "分流").length;
        const adminSupportCount = rules.filter((rule) => rule.category === "行政支援").length;
        return `<details class="position-rule-group" data-position-flight="${escapeHtml(flightNo)}"><summary><strong>${escapeHtml(flightNo)}</strong><span>${regularCount} 常规 · ${guideCount} 引导 · ${supervisorCount} 机动督导 · ${diversionCount} 分流 · ${adminSupportCount} 行政支援</span><i class="bi bi-chevron-down"></i></summary><div class="position-group-toolbar"><button class="btn btn-sm btn-outline-secondary" type="button" data-action="sort-counters-desc" data-flight-no="${escapeHtml(flightNo)}"><i class="bi bi-sort-numeric-down-alt me-1"></i>柜台从大到小</button></div><div class="table-responsive"><table class="table align-middle data-table position-rule-table"><thead><tr><th>顺序</th><th>航班</th><th>岗位</th><th>分类</th><th>疲劳点</th><th>启用旅客人数</th><th>提前撤岗</th><th>资质人员</th><th>备注</th><th class="action-col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>${rules.map((rule, ruleIndex) => `<tr>
          <td><div class="position-order-controls"><button class="btn btn-sm btn-light icon-btn" type="button" data-action="move-position-up" data-id="${rule.id}" title="上移岗位" ${ruleIndex === 0 ? "disabled" : ""}><i class="bi bi-arrow-up"></i></button><button class="btn btn-sm btn-light icon-btn" type="button" data-action="move-position-down" data-id="${rule.id}" title="下移岗位" ${ruleIndex === rules.length - 1 ? "disabled" : ""}><i class="bi bi-arrow-down"></i></button></div></td>
          <td><input class="form-control form-control-sm code-input" value="${escapeHtml(rule.flightNo)}" data-entity="position" data-id="${rule.id}" data-field="flightNo" aria-label="航班号"></td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(rule.name)}" data-entity="position" data-id="${rule.id}" data-field="name" aria-label="岗位名称"></td>
          <td><select class="form-select form-select-sm" data-entity="position" data-id="${rule.id}" data-field="category" aria-label="分类"><option ${rule.category === "常规" ? "selected" : ""}>常规</option><option ${rule.category === "引导" ? "selected" : ""}>引导</option><option ${rule.category === "机动督导" ? "selected" : ""}>机动督导</option><option ${rule.category === "分流" ? "selected" : ""}>分流</option><option ${rule.category === "行政支援" ? "selected" : ""}>行政支援</option></select></td>
          <td><input class="form-control form-control-sm number-input" type="number" min="0" step="0.5" value="${rule.fatiguePoints}" data-entity="position" data-id="${rule.id}" data-field="fatiguePoints" aria-label="疲劳点数"></td>
          <td><input class="form-control form-control-sm number-input" type="number" min="0" step="1" value="${rule.minPassengers ?? 0}" data-entity="position" data-id="${rule.id}" data-field="minPassengers" aria-label="启用旅客人数"></td>
          <td><input class="form-control form-control-sm number-input" type="number" min="0" max="180" step="5" value="${rule.earlyReleaseMinutes ?? 0}" ${rule.category === "分流" ? "" : "disabled"} data-entity="position" data-id="${rule.id}" data-field="earlyReleaseMinutes" aria-label="提前撤岗分钟"></td>
          <td>${rule.category === "引导" ? `<span class="guide-source-label"><i class="bi bi-arrow-down"></i>同航班最下方常规岗位人员</span>` : rule.category === "机动督导" ? `<button class="qualified-button" type="button" data-action="edit-qualified" data-id="${rule.id}"><span>${escapeHtml(names(state, rule.qualifiedStaffIds))}</span><i class="bi bi-chevron-right"></i></button>` : `<button class="qualified-button" type="button" data-action="edit-qualified" data-id="${rule.id}"><span>${rule.manual ? "手动补位" : escapeHtml(names(state, rule.qualifiedStaffIds))}</span><i class="bi bi-chevron-right"></i></button>`}</td>
          <td><input class="form-control form-control-sm" value="${escapeHtml(rule.remark)}" data-entity="position" data-id="${rule.id}" data-field="remark" aria-label="备注"></td>
          <td><button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="delete-position" data-id="${rule.id}" title="删除规则"><i class="bi bi-trash3"></i></button></td>
        </tr>`).join("")}</tbody></table></div></details>`;
      }).join("") || `<div class="empty-state">尚无岗位规则</div>`}</div>
    </section>
    <section class="workspace-section split-section settings-section">
      <div>
        <div class="section-heading"><h3>排班约束</h3></div>
        <div class="form-grid">
          <label class="form-label">每日工时上限<input class="form-control" type="number" min="1" max="24" step="0.5" value="${state.settings.maxDailyHours}" data-entity="settings" data-field="maxDailyHours"></label>
          <label class="form-label">历史统计天数<input class="form-control" type="number" min="1" max="90" value="${state.settings.historyWindowDays}" data-entity="settings" data-field="historyWindowDays"></label>
          <label class="form-label">连续工作惩罚<input class="form-control" type="number" min="0" step="0.5" value="${state.settings.consecutiveDayPenalty}" data-entity="settings" data-field="consecutiveDayPenalty"></label>
          <label class="form-label">夜班开始时间<input class="form-control" type="time" value="${escapeHtml(state.settings.nightStart)}" data-entity="settings" data-field="nightStart"></label>
          <label class="form-label">夜班结束时间<input class="form-control" type="time" value="${escapeHtml(state.settings.nightEnd)}" data-entity="settings" data-field="nightEnd"></label>
        </div>
      </div>
      <div>
        <div class="section-heading"><div><h3>航班计划模板</h3><span>每日航班页输入航班号后自动带出时间、岗位和备注</span></div><button class="btn btn-primary" type="button" data-action="add-template"><i class="bi bi-plus-lg me-2"></i>新增航班模板</button></div>
        <div class="template-editor">${state.templates.map((template) => `<div class="template-row">
          <input class="form-control form-control-sm code-input" value="${escapeHtml(template.flightNo)}" data-entity="template" data-id="${template.id}" data-field="flightNo" aria-label="模板航班号">
          <div class="time-range"><input class="form-control form-control-sm" type="time" value="${escapeHtml(template.startTime)}" data-entity="template" data-id="${template.id}" data-field="startTime" aria-label="模板开始时间"><span>至</span><input class="form-control form-control-sm" type="time" value="${escapeHtml(template.endTime)}" data-entity="template" data-id="${template.id}" data-field="endTime" aria-label="模板结束时间"></div>
          <input class="form-control form-control-sm template-positions" value="${escapeHtml(template.positions.join(", "))}" data-entity="template" data-id="${template.id}" data-field="positions" aria-label="模板岗位">
          <input class="form-control form-control-sm" value="${escapeHtml(template.remark)}" data-entity="template" data-id="${template.id}" data-field="remark" aria-label="模板备注">
          <button class="btn btn-sm btn-outline-danger icon-btn" type="button" data-action="delete-template" data-id="${template.id}" title="删除模板"><i class="bi bi-trash3"></i></button>
        </div>`).join("") || `<div class="empty-state">尚无航班模板</div>`}</div>
      </div>
    </section>`;
}
