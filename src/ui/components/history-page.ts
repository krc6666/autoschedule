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

export class HistoryPageElement extends LightDomElement {
  static override properties = { model: { attribute: false } };
  model!: AppState;

  protected override render() {
    const dates = [...new Set(this.model.history.map((item) => item.date))]
      .sort()
      .reverse();
    return html`<section class="workspace-section history-workspace">
      <div class="section-heading">
        <div>
          <h3>历史排班</h3>
          <span>${dates.length} 个工作日 · 按日期查看完整航班排班</span>
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
          dates.length
            ? dates.map((date, index) => this.day(date, index === 0))
            : html`<div class="empty-workspace">
                <i class="bi bi-clock-history"></i>
                <h3>暂无历史记录</h3>
              </div>`
        }
      </div>
    </section>`;
  }

  private groups(records: HistoryRecord[]): HistoryFlightGroup[] {
    const flightNumbers = [
      ...new Set(records.map((record) => record.flightNo || "未标注航班")),
    ];
    return flightNumbers
      .map((flightNo) => {
        const flightRecords = records.filter(
          (record) => (record.flightNo || "未标注航班") === flightNo
        );
        const ordered = flightRecords
          .map((record, index) => ({
            record,
            index,
            ruleIndex: this.model.positionRules.findIndex(
              (rule) =>
                rule.flightNo === record.flightNo &&
                rule.name === record.position
            ),
          }))
          .sort((left, right) => {
            const leftIndex =
              left.ruleIndex < 0 ? Number.MAX_SAFE_INTEGER : left.ruleIndex;
            const rightIndex =
              right.ruleIndex < 0 ? Number.MAX_SAFE_INTEGER : right.ruleIndex;
            return leftIndex - rightIndex || left.index - right.index;
          })
          .map(({ record }) => record);
        return {
          flightNo,
          startTime: flightRecords[0]?.startTime ?? "",
          endTime: flightRecords[0]?.endTime ?? "",
          records: ordered,
        };
      })
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }

  private day(date: string, newest: boolean) {
    const records = this.model.history.filter((item) => item.date === date);
    const groups = this.groups(records);
    const rowCount = Math.max(
      0,
      ...groups.map((group) => group.records.length)
    );
    const totalHours = records.reduce(
      (sum, record) => sum + record.workHours,
      0
    );
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
    return html`<details class="history-day" ?open=${newest}>
      <summary>
        <span
          ><strong>${date}</strong
          ><small
            >${groups.length} 个航班 · ${records.length} 个岗位 ·
            ${totalHours.toFixed(1)} 总工时</small
          ></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      <div class="history-schedule-board">
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
              { length: rowCount },
              (_, rowIndex) =>
                html`<tr>
                  ${groups.map((group) => this.recordCells(group.records[rowIndex]))}
                </tr>`
            )}
          </tbody>
        </table>
      </div>
    </details>`;
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
