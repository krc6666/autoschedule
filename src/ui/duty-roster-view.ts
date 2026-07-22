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

function dutyCoverage(item: DutyRosterPersonStats): string {
  if (!item.staff.dutyQualified) return `<span class="duty-coverage-badge is-neutral">不参与值班</span>`;
  if (!item.dutyDates.length) return `<span class="duty-coverage-badge is-missing">首轮待安排</span>`;
  if (item.dutyDates.length === 1) return `<span class="duty-coverage-badge is-complete">首轮已保障</span>`;
  return `<span class="duty-coverage-badge is-complete">已进入第 ${item.dutyDates.length} 轮</span>`;
}

function countRange(counts: number[]): { min: number; max: number; difference: number } {
  if (!counts.length) return { min: 0, max: 0, difference: 0 };
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return { min, max, difference: max - min };
}

function statsRows(stats: DutyRosterPersonStats[], kind: "cx" | "general", dutyFatiguePoints = 0): string {
  if (!stats.length) return `<tr><td colspan="${kind === "cx" ? 3 : 6}" class="text-secondary">暂无符合条件的人员</td></tr>`;
  return stats.map((item) => kind === "cx"
    ? `<tr><td><strong>${escapeHtml(item.staff.name)}</strong></td><td>${item.cxPreflightDates.length}</td><td>${escapeHtml(shortDates(item.cxPreflightDates))}</td></tr>`
    : `<tr><td><strong>${escapeHtml(item.staff.name)}</strong>${item.staff.dutyQualified ? "" : `<small class="duty-no-qualification">无值班资质</small>`}</td><td>${dutyCoverage(item)}</td><td>${item.dutyDates.length}</td><td><strong class="duty-planned-fatigue">${item.dutyDates.length * dutyFatiguePoints} 点</strong></td><td>${item.standbyDates.length}</td><td>${escapeHtml([...item.dutyDates.map((date) => `${date.slice(5)}值班`), ...item.standbyDates.map((date) => `${date.slice(5)}备勤`)].join("、") || "-")}</td></tr>`).join("");
}

function resetButton(row: DutyRosterAssignment): string {
  return `<button class="btn btn-sm btn-light icon-btn" type="button" data-action="reset-duty-roster" data-id="${escapeHtml(row.date)}" title="恢复该日全部顺序轮值" ${row.adjusted ? "" : "disabled"}><i class="bi bi-arrow-counterclockwise"></i></button>`;
}

export function renderDutyRosterSummary(state: AppState, date: string): string {
  const current = getDutyRosterForDate(state, date);
  return `<aside class="duty-roster-summary" aria-label="当日轮值">
    <div class="duty-roster-summary-head"><div><h3>当日轮值</h3><span>${escapeHtml(date)}</span></div><i class="bi bi-person-check"></i></div>
    <div class="duty-roster-cards">
      <article class="duty-roster-card is-cx"><span><i class="bi bi-airplane-engines"></i>CX航前</span><strong>${escapeHtml(personName(state, current.cxPreflightStaffId))}</strong></article>
      <article class="duty-roster-card is-duty"><span><i class="bi bi-person-workspace"></i>值班人员</span><strong>${escapeHtml(personName(state, current.dutyStaffId))}</strong><small><i class="bi bi-activity"></i>本次值班 +${state.settings.dutyFatiguePoints} 疲劳点</small></article>
      <article class="duty-roster-card is-standby"><span><i class="bi bi-people"></i>备勤人员</span><strong>${escapeHtml(current.standbyStaffIds.map((staffId) => personName(state, staffId)).join("、"))}</strong></article>
    </div>
  </aside>`;
}

export function renderDutyRosterDetails(state: AppState, date: string): string {
  const monthly = getMonthlyDutyRoster(state, date);
  const stats = getMonthlyDutyRosterStats(state, date);
  const cxStaff = cxPreflightEligibleStaff(state);
  const dutyStaff = dutyQualifiedStaff(state);
  const regularStaff = rosterEligibleStaff(state);
  const cxIds = new Set(cxStaff.map((person) => person.id));
  const cxStats = stats.filter((item) => cxIds.has(item.staff.id));
  const cxRange = countRange(cxStats.map((item) => item.cxPreflightDates.length));
  const standbyRange = countRange(stats.map((item) => item.standbyDates.length));
  const dutyRange = countRange(stats.filter((item) => item.staff.dutyQualified).map((item) => item.dutyDates.length));
  const firstRoundCovered = stats.filter((item) => item.staff.dutyQualified && item.dutyDates.length > 0).length;
  const missingDuty = stats.filter((item) => item.staff.dutyQualified && item.dutyDates.length === 0);
  const dutySeatShortage = monthly.filter((row) => row.dutyStaffId).length < dutyStaff.length;
  const standbyMissing = stats.filter((item) => item.standbyDates.length < 2);
  const standbyCapacity = monthly.reduce((sum, row) => sum + Math.min(2, Math.max(0, regularStaff.length - (row.dutyStaffId ? 1 : 0))), 0);
  const standbySeatShortage = standbyCapacity < regularStaff.length * 2;
  const unfilledCxRows = monthly.filter((row) => !row.cxPreflightStaffId);
  const hasMonthlyAdjustments = monthly.some((row) => row.adjusted);
  const imbalanceDetails = (missingDuty.length && !dutySeatShortage) || dutyRange.difference > 1
    ? `<div class="duty-balance-alert is-attention"><i class="bi bi-exclamation-triangle-fill"></i><div><strong>值班均衡未完成</strong><span>${escapeHtml(stats.filter((item) => item.staff.dutyQualified).map((item) => `${item.staff.name} ${item.dutyDates.length} 次`).join("、"))}。</span>${hasMonthlyAdjustments ? `<span>本月存在人工调整，自动均衡不会覆盖手工结果。</span>` : `<span>请恢复本月自动均衡，系统会先补齐 0 次人员并将次数差控制在 1 以内。</span>`}</div>${hasMonthlyAdjustments ? `<button class="btn btn-sm btn-outline-danger" type="button" data-action="rebalance-duty-roster-month" data-id="${escapeHtml(date)}"><i class="bi bi-arrow-repeat me-1"></i>重新均衡本月</button>` : ""}</div>`
    : missingDuty.length && dutySeatShortage
      ? `<div class="duty-balance-alert is-info"><i class="bi bi-info-circle-fill"></i><div><strong>本月值班席位不足</strong><span>${escapeHtml(missingDuty.map((item) => item.staff.name).join("、"))}本月暂缺 1 次值班，缺额会在后续月份轮换。</span></div></div>`
      : "";
  const standbyDetails = standbyMissing.length
    ? `<div class="duty-balance-alert ${standbySeatShortage ? "is-info" : "is-attention"}"><i class="bi bi-${standbySeatShortage ? "info-circle-fill" : "exclamation-triangle-fill"}"></i><div><strong>${standbySeatShortage ? "本月备勤席位不足" : "备勤保底未完成"}</strong><span>${escapeHtml(standbyMissing.map((item) => `${item.staff.name} ${item.standbyDates.length} 次`).join("、"))}。${standbySeatShortage ? "值班刚性要求优先，备勤缺额只作说明，不计入违约。" : "每名正常常规人员应至少安排 2 次备勤。"}</span></div></div>`
    : "";
  return `<section class="workspace-section duty-roster-details-section">
    <div class="section-heading"><div><h3>月度轮值明细</h3><span>${escapeHtml(date)} · 值班与其他轮值互斥，CX航前可兼任备勤</span></div></div>
    <div class="duty-roster-groups">
      <details class="duty-roster-details" data-duty-roster-section="cx"><summary><span><i class="bi bi-airplane-engines me-2"></i>CX航前轮换</span><i class="bi bi-chevron-down"></i></summary><div class="duty-roster-detail-body">
        <div class="duty-balance-summary"><span>资质人员 <strong>${cxStaff.length}</strong></span><span>次数范围 <strong>${cxRange.min}-${cxRange.max}</strong></span><span>航前差值 <strong>${cxRange.difference}</strong></span></div>
        <div class="table-responsive"><table class="table table-sm align-middle duty-roster-fairness-table"><thead><tr><th>资格人员</th><th>本月次数</th><th>轮值日期</th></tr></thead><tbody>${statsRows(cxStats, "cx")}</tbody></table></div>
        <div class="table-responsive duty-roster-table-wrap"><table class="table table-sm align-middle duty-roster-table"><thead><tr><th>工作日</th><th>CX航前</th><th class="action-col"></th></tr></thead><tbody>
          ${monthly.map((row) => {
            const cxOptions = cxStaff.filter((person) => person.id === row.cxPreflightStaffId || person.id !== row.dutyStaffId);
            return `<tr class="${row.date === date ? "is-current" : ""}"><td><strong>${escapeHtml(row.date.slice(5))}</strong>${row.adjusted ? `<span class="duty-adjusted-mark">已调整</span>` : ""}</td><td>${rosterSelect(cxOptions, row, "cx-preflight", row.cxPreflightStaffId, "CX航前")}</td><td>${resetButton(row)}</td></tr>`;
          }).join("")}
        </tbody></table></div>
        ${!cxStaff.length ? `<div class="duty-roster-warning"><i class="bi bi-exclamation-triangle"></i><span>尚未配置CX航前资质人员</span></div>` : unfilledCxRows.length ? `<div class="duty-roster-warning"><i class="bi bi-exclamation-triangle"></i><span>值班优先后，本月 ${unfilledCxRows.length} 个工作日没有剩余CX航前资质人员，请增加CX资质人员或人工调整。</span></div>` : ""}
      </div></details>
      <details class="duty-roster-details" data-duty-roster-section="general"><summary><span><i class="bi bi-people me-2"></i>值班与备勤轮换</span><i class="bi bi-chevron-down"></i></summary><div class="duty-roster-detail-body">
        <div class="duty-balance-summary"><span>值班席位 <strong>${monthly.length}</strong></span><span>资质人员 <strong>${dutyStaff.length}</strong></span><span>首轮覆盖 <strong>${firstRoundCovered}/${dutyStaff.length}</strong></span><span>值班差值 <strong>${dutyRange.difference}</strong></span><span>备勤差值 <strong>${standbyRange.difference}</strong></span><span>备勤保底 <strong>2 次</strong></span><span>每次值班 <strong>${state.settings.dutyFatiguePoints} 点</strong></span></div>
        ${imbalanceDetails}
        ${standbyDetails}
        <div class="table-responsive"><table class="table table-sm align-middle duty-roster-fairness-table"><thead><tr><th>人员</th><th>值班保障</th><th>本月值班</th><th>计划疲劳</th><th>本月备勤</th><th>轮值日期</th></tr></thead><tbody>${statsRows(stats, "general", state.settings.dutyFatiguePoints)}</tbody></table></div>
        <div class="table-responsive duty-roster-table-wrap"><table class="table table-sm align-middle duty-roster-table"><thead><tr><th>工作日</th><th>值班人员</th><th>备勤一</th><th>备勤二</th><th class="action-col"></th></tr></thead><tbody>
          ${monthly.map((row) => {
            const standbyOptions = regularStaff.filter((person) => person.id !== row.dutyStaffId);
            const dutyOptions = dutyStaff.filter((person) => person.id !== row.cxPreflightStaffId);
            return `<tr class="${row.date === date ? "is-current" : ""}"><td><strong>${escapeHtml(row.date.slice(5))}</strong>${row.adjusted ? `<span class="duty-adjusted-mark">已调整</span>` : ""}</td><td>${rosterSelect(dutyOptions, row, "duty", row.dutyStaffId, "值班人员")}</td><td>${rosterSelect(standbyOptions, row, "standby-0", row.standbyStaffIds[0], "备勤一")}</td><td>${rosterSelect(standbyOptions, row, "standby-1", row.standbyStaffIds[1], "备勤二")}</td><td>${resetButton(row)}</td></tr>`;
          }).join("")}
        </tbody></table></div>
        ${dutyStaff.length ? "" : `<div class="duty-roster-warning"><i class="bi bi-exclamation-triangle"></i><span>尚未配置值班资质人员</span></div>`}
      </div></details>
    </div>
  </section>`;
}
