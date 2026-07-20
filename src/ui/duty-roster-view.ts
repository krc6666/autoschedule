import type { AppState, Staff } from "../model";
import {
  cxPreflightEligibleStaff,
  dutyQualifiedStaff,
  getDutyRosterForDate,
  getMonthlyDutyRoster,
  getMonthlyDutyRosterStats,
  rosterEligibleStaff,
  type DutyRosterAssignment,
  type DutyRosterPersonStats,
  type DutyRosterSlot
} from "../domain/duty-roster";
import { escapeHtml } from "../utils";

function personName(state: AppState, staffId: string | null): string {
  return staffId ? state.staff.find((person) => person.id === staffId)?.name ?? `#${staffId}` : "未配置";
}

function options(staff: Staff[], selectedId: string | null): string {
  return [`<option value="">未配置</option>`, ...staff.map((person) => `<option value="${escapeHtml(person.id)}" ${person.id === selectedId ? "selected" : ""}>${escapeHtml(person.name)}</option>`)].join("");
}

function rosterSelect(staff: Staff[], row: DutyRosterAssignment, slot: DutyRosterSlot, selectedId: string | null, label: string): string {
  return `<select class="form-select form-select-sm" data-entity="duty-roster" data-id="${escapeHtml(row.date)}" data-field="staffId" data-duty-slot="${slot}" aria-label="${escapeHtml(`${row.date} ${label}`)}">${options(staff, selectedId)}</select>`;
}

function shortDates(dates: string[]): string {
  return dates.length ? dates.map((date) => date.slice(5)).join("、") : "-";
}

function statsRows(stats: DutyRosterPersonStats[], kind: "cx" | "general"): string {
  if (!stats.length) return `<tr><td colspan="${kind === "cx" ? 3 : 5}" class="text-secondary">暂无符合条件的人员</td></tr>`;
  return stats.map((item) => kind === "cx"
    ? `<tr><td><strong>${escapeHtml(item.staff.name)}</strong></td><td>${item.cxPreflightDates.length}</td><td>${escapeHtml(shortDates(item.cxPreflightDates))}</td></tr>`
    : `<tr><td><strong>${escapeHtml(item.staff.name)}</strong>${item.staff.dutyQualified ? "" : `<small class="duty-no-qualification">无值班资质</small>`}</td><td>${item.dutyDates.length}</td><td>${item.standbyDates.length}</td><td>${item.dutyDates.length + item.standbyDates.length}</td><td>${escapeHtml([...item.dutyDates.map((date) => `${date.slice(5)}值班`), ...item.standbyDates.map((date) => `${date.slice(5)}备勤`)].join("、") || "-")}</td></tr>`).join("");
}

function resetButton(row: DutyRosterAssignment): string {
  return `<button class="btn btn-sm btn-light icon-btn" type="button" data-action="reset-duty-roster" data-id="${escapeHtml(row.date)}" title="恢复该日全部顺序轮值" ${row.adjusted ? "" : "disabled"}><i class="bi bi-arrow-counterclockwise"></i></button>`;
}

export function renderDutyRoster(state: AppState, date: string): string {
  const current = getDutyRosterForDate(state, date);
  const monthly = getMonthlyDutyRoster(state, date);
  const stats = getMonthlyDutyRosterStats(state, date);
  const cxStaff = cxPreflightEligibleStaff(state);
  const dutyStaff = dutyQualifiedStaff(state);
  const regularStaff = rosterEligibleStaff(state);
  const cxIds = new Set(cxStaff.map((person) => person.id));
  return `<section class="workspace-section duty-roster-section">
    <div class="section-heading"><div><h3>当日轮值</h3><span>${escapeHtml(date)} · 四个人选互不重复 · 值班计 ${state.settings.dutyFatiguePoints} 点疲劳</span></div></div>
    <div class="duty-roster-cards">
      <article class="duty-roster-card is-cx"><span><i class="bi bi-airplane-engines"></i>CX航前</span><strong>${escapeHtml(personName(state, current.cxPreflightStaffId))}</strong></article>
      <article class="duty-roster-card is-duty"><span><i class="bi bi-person-workspace"></i>值班人员</span><strong>${escapeHtml(personName(state, current.dutyStaffId))}</strong></article>
      <article class="duty-roster-card is-standby"><span><i class="bi bi-people"></i>备勤人员</span><strong>${escapeHtml(current.standbyStaffIds.map((staffId) => personName(state, staffId)).join("、"))}</strong></article>
    </div>
    <div class="duty-roster-groups">
      <details class="duty-roster-details" data-duty-roster-section="cx"><summary><span><i class="bi bi-airplane-engines me-2"></i>CX航前轮换</span><i class="bi bi-chevron-down"></i></summary><div class="duty-roster-detail-body">
        <div class="table-responsive"><table class="table table-sm align-middle duty-roster-fairness-table"><thead><tr><th>资格人员</th><th>本月次数</th><th>轮值日期</th></tr></thead><tbody>${statsRows(stats.filter((item) => cxIds.has(item.staff.id)), "cx")}</tbody></table></div>
        <div class="table-responsive duty-roster-table-wrap"><table class="table table-sm align-middle duty-roster-table"><thead><tr><th>工作日</th><th>CX航前</th><th class="action-col"></th></tr></thead><tbody>
          ${monthly.map((row) => {
            const cxOptions = cxStaff.filter((person) => person.id === row.cxPreflightStaffId || ![row.dutyStaffId, ...row.standbyStaffIds].includes(person.id));
            return `<tr class="${row.date === date ? "is-current" : ""}"><td><strong>${escapeHtml(row.date.slice(5))}</strong>${row.adjusted ? `<span class="duty-adjusted-mark">已调整</span>` : ""}</td><td>${rosterSelect(cxOptions, row, "cx-preflight", row.cxPreflightStaffId, "CX航前")}</td><td>${resetButton(row)}</td></tr>`;
          }).join("")}
        </tbody></table></div>
        ${cxStaff.length ? "" : `<div class="duty-roster-warning"><i class="bi bi-exclamation-triangle"></i><span>尚未配置CX航前资质人员</span></div>`}
      </div></details>
      <details class="duty-roster-details" data-duty-roster-section="general"><summary><span><i class="bi bi-people me-2"></i>值班与备勤轮换</span><i class="bi bi-chevron-down"></i></summary><div class="duty-roster-detail-body">
        <div class="table-responsive"><table class="table table-sm align-middle duty-roster-fairness-table"><thead><tr><th>人员</th><th>本月值班</th><th>本月备勤</th><th>轮值合计</th><th>轮值日期</th></tr></thead><tbody>${statsRows(stats, "general")}</tbody></table></div>
        <div class="table-responsive duty-roster-table-wrap"><table class="table table-sm align-middle duty-roster-table"><thead><tr><th>工作日</th><th>值班人员</th><th>备勤一</th><th>备勤二</th><th class="action-col"></th></tr></thead><tbody>
          ${monthly.map((row) => {
            const generalOptions = regularStaff.filter((person) => person.id !== row.cxPreflightStaffId);
            const dutyOptions = dutyStaff.filter((person) => person.id !== row.cxPreflightStaffId);
            return `<tr class="${row.date === date ? "is-current" : ""}"><td><strong>${escapeHtml(row.date.slice(5))}</strong>${row.adjusted ? `<span class="duty-adjusted-mark">已调整</span>` : ""}</td><td>${rosterSelect(dutyOptions, row, "duty", row.dutyStaffId, "值班人员")}</td><td>${rosterSelect(generalOptions, row, "standby-0", row.standbyStaffIds[0], "备勤一")}</td><td>${rosterSelect(generalOptions, row, "standby-1", row.standbyStaffIds[1], "备勤二")}</td><td>${resetButton(row)}</td></tr>`;
          }).join("")}
        </tbody></table></div>
        ${dutyStaff.length ? "" : `<div class="duty-roster-warning"><i class="bi bi-exclamation-triangle"></i><span>尚未配置值班资质人员</span></div>`}
      </div></details>
    </div>
  </section>`;
}
