import type { AppState, HistoryRecord } from "../model";
import { escapeHtml } from "../utils";

interface HistoryFlightGroup {
  flightNo: string;
  startTime: string;
  endTime: string;
  records: HistoryRecord[];
}

function historyFlightGroups(state: AppState, records: HistoryRecord[]): HistoryFlightGroup[] {
  const flightNumbers = [...new Set(records.map((record) => record.flightNo || "未标注航班"))];
  return flightNumbers.map((flightNo) => {
    const flightRecords = records.filter((record) => (record.flightNo || "未标注航班") === flightNo);
    const ordered = flightRecords.map((record, index) => ({
      record,
      index,
      ruleIndex: state.positionRules.findIndex((rule) => rule.flightNo === record.flightNo && rule.name === record.position)
    })).sort((left, right) => {
      const leftIndex = left.ruleIndex < 0 ? Number.MAX_SAFE_INTEGER : left.ruleIndex;
      const rightIndex = right.ruleIndex < 0 ? Number.MAX_SAFE_INTEGER : right.ruleIndex;
      return leftIndex - rightIndex || left.index - right.index;
    }).map(({ record }) => record);
    return {
      flightNo,
      startTime: flightRecords[0]?.startTime ?? "",
      endTime: flightRecords[0]?.endTime ?? "",
      records: ordered
    };
  }).sort((left, right) => left.startTime.localeCompare(right.startTime));
}

function historyRecordCells(record: HistoryRecord): string {
  return `<td class="schedule-grid-slot schedule-position-slot"><article class="schedule-cell schedule-position-cell is-assigned">
    <div class="schedule-position-content"><strong class="schedule-position" title="${escapeHtml(record.position)}">${escapeHtml(record.position)}</strong>${record.remark ? `<span class="position-remark">${escapeHtml(record.remark)}</span>` : ""}</div>
  </article></td><td class="schedule-grid-slot schedule-person-slot"><article class="schedule-cell schedule-person-cell is-assigned">
    <strong class="history-person">${escapeHtml(record.staffName)}</strong><span class="history-load">${record.workHours.toFixed(1)}h · 疲劳 ${record.fatiguePoints.toFixed(1)}</span>
    <div class="schedule-cell-actions"><button class="btn btn-sm btn-light icon-btn" type="button" data-action="delete-history" data-id="${escapeHtml(record.id)}" title="删除这条历史记录"><i class="bi bi-trash3"></i></button></div>
  </article></td>`;
}

function emptyHistoryCells(): string {
  return `<td class="schedule-grid-slot schedule-position-slot"><div class="schedule-cell history-empty-cell"></div></td><td class="schedule-grid-slot schedule-person-slot"><div class="schedule-cell history-empty-cell"></div></td>`;
}

function renderHistoryDay(state: AppState, date: string, newest: boolean): string {
  const records = state.history.filter((item) => item.date === date);
  const groups = historyFlightGroups(state, records);
  const rowCount = Math.max(0, ...groups.map((group) => group.records.length));
  const columns = groups.map(() => `<col class="schedule-position-column"><col class="schedule-person-column">`).join("");
  const headers = groups.map((group) => `<th scope="col" colspan="2"><div class="schedule-flight-head"><div><strong>${escapeHtml(group.flightNo)}</strong><span>${escapeHtml(group.startTime && group.endTime ? `${group.startTime}–${group.endTime}` : "未记录时段")}</span></div></div></th>`).join("");
  const subHeaders = groups.map(() => `<th scope="col" class="schedule-subhead-position">岗位</th><th scope="col" class="schedule-subhead-person">人员</th>`).join("");
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => `<tr>${groups.map((group) => group.records[rowIndex] ? historyRecordCells(group.records[rowIndex]) : emptyHistoryCells()).join("")}</tr>`).join("");
  const totalHours = records.reduce((sum, record) => sum + record.workHours, 0);
  const style = `--flight-count:${Math.max(1, groups.length)};--schedule-column-width:64px;--schedule-person-column-width:64px;--schedule-flight-width:128px;--schedule-header-height:50px;--schedule-cell-height:40px;--schedule-flight-size:14px;--schedule-position-size:11px;--schedule-small-size:10px;--schedule-tiny-size:9px;`;
  return `<details class="history-day" ${newest ? "open" : ""}>
    <summary><span><strong>${escapeHtml(date)}</strong><small>${groups.length} 个航班 · ${records.length} 个岗位 · ${totalHours.toFixed(1)} 总工时</small></span><i class="bi bi-chevron-down"></i></summary>
    <div class="history-schedule-board">
      <table class="schedule-grid-table history-schedule-grid" style="${style}"><colgroup>${columns}</colgroup><thead><tr>${headers}</tr><tr class="schedule-subhead-row">${subHeaders}</tr></thead><tbody>${rows}</tbody></table>
    </div>
  </details>`;
}

export function renderHistory(state: AppState): string {
  const dates = [...new Set(state.history.map((item) => item.date))].sort().reverse();
  return `<section class="workspace-section history-workspace">
    <div class="section-heading"><div><h3>历史排班</h3><span>${dates.length} 个工作日 · 按日期查看完整航班排班</span></div><div class="d-flex gap-2"><button class="btn btn-outline-secondary" type="button" data-action="import-history"><i class="bi bi-file-earmark-arrow-up me-2"></i>导入历史排班结果</button><button class="btn btn-outline-danger" type="button" data-action="clear-history"><i class="bi bi-trash3 me-2"></i>清空历史</button></div></div>
    <div class="history-day-list">${dates.length ? dates.map((date, index) => renderHistoryDay(state, date, index === 0)).join("") : `<div class="empty-workspace"><i class="bi bi-clock-history"></i><h3>暂无历史记录</h3></div>`}</div>
  </section>`;
}
