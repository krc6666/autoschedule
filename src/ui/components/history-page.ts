import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import type { AppState, HistoryRecord } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

interface HistoryFlightGroup {
  flightNo: string;
  startTime: string;
  endTime: string;
  records: HistoryRecord[];
}

interface HistoryDayView {
  date: string;
  groups: HistoryFlightGroup[];
  recordCount: number;
  rowCount: number;
  totalHours: number;
}

function positionOrderKey(flightNo: string, position: string): string {
  return `${flightNo}\u0000${position}`;
}

export class HistoryPageElement extends LightDomElement {
  static override properties = { model: { attribute: false } };
  model!: AppState;
  private readonly expandedDates = new Set<string>();
  private newestDate: string | null = null;

  protected override render() {
    const days = this.days();
    this.syncExpandedDates(days);
    return html`<section class="workspace-section history-workspace">
      <div class="section-heading">
        <div>
          <h3>历史排班</h3>
          <span>${days.length} 个工作日 · 按日期查看完整航班排班</span>
        </div>
        <div class="d-flex gap-2">
          <button
            class="btn btn-outline-secondary"
            type="button"
            @click=${() => dispatchUiCommand(this, { type: "open-import", mode: "history" })}
          >
            <i class="bi bi-file-earmark-arrow-up me-2"></i>导入历史排班结果
          </button>
          <button
            class="btn btn-outline-danger"
            type="button"
            @click=${() => dispatchUiCommand(this, { type: "clear-history" })}
          >
            <i class="bi bi-trash3 me-2"></i>清空历史
          </button>
        </div>
      </div>
      <div class="history-day-list">
        ${
          days.length
            ? days.map((day) => this.day(day))
            : html`<div class="empty-workspace">
                <i class="bi bi-clock-history"></i>
                <h3>暂无历史记录</h3>
              </div>`
        }
      </div>
    </section>`;
  }

  private days(): HistoryDayView[] {
    const recordsByDate = new Map<string, HistoryRecord[]>();
    for (const record of this.model.history) {
      const records = recordsByDate.get(record.date) ?? [];
      records.push(record);
      recordsByDate.set(record.date, records);
    }
    const positionOrder = new Map<string, number>();
    this.model.positionRules.forEach((rule, index) => {
      const key = positionOrderKey(rule.flightNo, rule.name);
      if (!positionOrder.has(key)) positionOrder.set(key, index);
    });
    return [...recordsByDate.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([date, records]) => {
        const groups = this.groups(records, positionOrder);
        return {
          date,
          groups,
          recordCount: records.length,
          rowCount: Math.max(0, ...groups.map((group) => group.records.length)),
          totalHours: records.reduce(
            (sum, record) => sum + record.workHours,
            0
          ),
        };
      });
  }

  private syncExpandedDates(days: readonly HistoryDayView[]): void {
    const newestDate = days[0]?.date ?? null;
    if (newestDate !== this.newestDate) {
      this.expandedDates.clear();
      if (newestDate) this.expandedDates.add(newestDate);
      this.newestDate = newestDate;
    }
    const availableDates = new Set(days.map((day) => day.date));
    for (const date of this.expandedDates) {
      if (!availableDates.has(date)) this.expandedDates.delete(date);
    }
  }

  private groups(
    records: HistoryRecord[],
    positionOrder: ReadonlyMap<string, number>
  ): HistoryFlightGroup[] {
    const recordsByFlight = new Map<
      string,
      Array<{ record: HistoryRecord; index: number }>
    >();
    records.forEach((record, index) => {
      const flightNo = record.flightNo || "未标注航班";
      const flightRecords = recordsByFlight.get(flightNo) ?? [];
      flightRecords.push({ record, index });
      recordsByFlight.set(flightNo, flightRecords);
    });
    return [...recordsByFlight.entries()]
      .map(([flightNo, indexedRecords]) => {
        const ordered = indexedRecords
          .sort((left, right) => {
            const leftIndex =
              positionOrder.get(
                positionOrderKey(left.record.flightNo, left.record.position)
              ) ?? Number.MAX_SAFE_INTEGER;
            const rightIndex =
              positionOrder.get(
                positionOrderKey(right.record.flightNo, right.record.position)
              ) ?? Number.MAX_SAFE_INTEGER;
            return leftIndex - rightIndex || left.index - right.index;
          })
          .map(({ record }) => record);
        return {
          flightNo,
          startTime: indexedRecords[0]?.record.startTime ?? "",
          endTime: indexedRecords[0]?.record.endTime ?? "",
          records: ordered,
        };
      })
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }

  private day(day: HistoryDayView) {
    const expanded = this.expandedDates.has(day.date);
    const groups = day.groups;
    const styles = {
      "--flight-count": String(Math.max(1, groups.length)),
      "--schedule-column-width": "64px",
      "--schedule-person-column-width": "64px",
      "--schedule-flight-width": "128px",
      "--schedule-header-height": "50px",
      "--schedule-cell-height": "40px",
      "--schedule-flight-size": "14px",
      "--schedule-position-size": "11px",
      "--schedule-small-size": "10px",
      "--schedule-tiny-size": "9px",
    };
    return html`<details
      class="history-day"
      .open=${expanded}
      @toggle=${(event: Event) => this.toggleDay(day.date, event)}
    >
      <summary>
        <span
          ><strong>${day.date}</strong
          ><small
            >${groups.length} 个航班 · ${day.recordCount} 个岗位 ·
            ${day.totalHours.toFixed(1)} 总工时</small
          ></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      ${
        expanded
          ? html`<div class="history-schedule-board">
              <table
                class="schedule-grid-table history-schedule-grid"
                style=${styleMap(styles)}
              >
                <colgroup>
                  ${groups.flatMap(() => [html`<col class="schedule-position-column" />`, html`<col class="schedule-person-column" />`])}
                </colgroup>
                <thead>
                  <tr>
                    ${groups.map(
                      (group) =>
                        html`<th scope="col" colspan="2">
                          <div class="schedule-flight-head">
                            <div>
                              <strong>${group.flightNo}</strong
                              ><span
                                >${group.startTime && group.endTime ? `${group.startTime}–${group.endTime}` : "未记录时段"}</span
                              >
                            </div>
                          </div>
                        </th>`
                    )}
                  </tr>
                  <tr class="schedule-subhead-row">
                    ${groups.flatMap(() => [html`<th scope="col" class="schedule-subhead-position">岗位</th>`, html`<th scope="col" class="schedule-subhead-person">人员</th>`])}
                  </tr>
                </thead>
                <tbody>
                  ${Array.from(
                    { length: day.rowCount },
                    (_, rowIndex) =>
                      html`<tr>
                        ${groups.map((group) => this.recordCells(group.records[rowIndex]))}
                      </tr>`
                  )}
                </tbody>
              </table>
            </div>`
          : null
      }
    </details>`;
  }

  private toggleDay(date: string, event: Event): void {
    const expanded = (event.currentTarget as HTMLDetailsElement).open;
    if (expanded === this.expandedDates.has(date)) return;
    if (expanded) this.expandedDates.add(date);
    else this.expandedDates.delete(date);
    this.requestUpdate();
  }

  private recordCells(record?: HistoryRecord) {
    if (!record)
      return [
        html`<td class="schedule-grid-slot schedule-position-slot">
          <div class="schedule-cell history-empty-cell"></div>
        </td>`,
        html`<td class="schedule-grid-slot schedule-person-slot">
          <div class="schedule-cell history-empty-cell"></div>
        </td>`,
      ];
    return [
      html`<td class="schedule-grid-slot schedule-position-slot">
        <article class="schedule-cell schedule-position-cell is-assigned">
          <div class="schedule-position-content">
            <strong class="schedule-position" title=${record.position}
              >${record.position}</strong
            >${record.remark ? html`<span class="position-remark">${record.remark}</span>` : null}
          </div>
        </article>
      </td>`,
      html`<td class="schedule-grid-slot schedule-person-slot">
        <article class="schedule-cell schedule-person-cell is-assigned">
          <strong class="history-person">${record.staffName}</strong
          ><span class="history-load"
            >${record.workHours.toFixed(1)}h · 疲劳
            ${record.fatiguePoints.toFixed(1)}</span
          >
          <div class="schedule-cell-actions">
            <button
              class="btn btn-sm btn-light icon-btn"
              type="button"
              title="删除这条历史记录"
              aria-label="删除这条历史记录"
              @click=${() => dispatchUiCommand(this, { type: "delete-history", id: record.id })}
            >
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        </article>
      </td>`,
    ];
  }
}

customElements.define("autoschedule-history-page", HistoryPageElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-history-page": HistoryPageElement;
  }
}
