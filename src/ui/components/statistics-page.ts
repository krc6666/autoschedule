import { html } from "lit";

import { buildMonthlyPositionStatistics } from "../../domain/statistics/monthly-position-statistics";
import { buildMonthlyRelaxedShiftStatistics } from "../../domain/statistics/relaxed-shift-statistics";
import type { AppState } from "../../model";
import { LightDomElement } from "./light-dom-element";
import "./duty-roster-details";

const TR121_H02_TARGET = { flightNo: "TR121", position: "H02" } as const;

export class StatisticsPageElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    date: { type: String },
  };
  model!: AppState;
  date = "";

  protected override render() {
    return html`
      <autoschedule-duty-roster-details
        .model=${this.model}
        .date=${this.date}
      ></autoschedule-duty-roster-details>
      ${this.relaxedShiftStatistics()} ${this.positionStatistics()}
    `;
  }

  private relaxedShiftStatistics() {
    const statistics = buildMonthlyRelaxedShiftStatistics(
      this.model,
      this.date
    );
    const rows = [...statistics.rows].sort(
      (left, right) =>
        right.earlyDepartures.length - left.earlyDepartures.length ||
        right.afternoonRestDates.length - left.afternoonRestDates.length ||
        left.staff.name.localeCompare(right.staff.name, "zh-CN")
    );
    return html`<section class="workspace-section relaxed-shift-statistics">
      <div class="section-heading">
        <div>
          <h3>月度轻松班次统计</h3>
          <span>${statistics.month} · 仅统计实际参加排班的常规人员</span>
        </div>
      </div>
      <div class="relaxed-shift-today">
        <div>
          <strong>今日提前下班</strong
          ><small
            >最后航班截载严格早于
            ${this.model.settings.earlyDepartureCutoffTime}，排除当日值班</small
          >
          <div>
            ${statistics.currentEarlyDepartures.length ? statistics.currentEarlyDepartures.map((item) => html`<span><strong>${item.staffName}</strong> ${item.flightNo} / ${item.cutoffTime} <em>本月 ${item.monthlyCount} 次</em></span>`) : html`<span class="is-empty">今日没有符合节点的提前下班人员</span>`}
          </div>
        </div>
        <div>
          <strong>今日下午无航班</strong
          ><small
            >${this.model.settings.afternoonRestStartTime}-${this.model.settings.afternoonRestEndTime}
            无航班重叠，值班和备勤照常计入</small
          >
          <div>
            ${statistics.currentAfternoonRest.length ? statistics.currentAfternoonRest.map((item) => html`<span><strong>${item.staffName}</strong> <em>本月 ${item.monthlyCount} 次</em></span>`) : html`<span class="is-empty">今日没有下午无航班人员</span>`}
          </div>
        </div>
      </div>
      <div class="table-responsive">
        <table
          class="table table-sm align-middle data-table relaxed-shift-table"
        >
          <thead>
            <tr>
              <th>常规人员</th>
              <th>提前下班次数</th>
              <th>提前下班日期 / 最后航班 / 截载</th>
              <th>下午无航班次数</th>
              <th>下午无航班日期</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (row) =>
                html`<tr>
                  <td><strong>${row.staff.name}</strong></td>
                  <td>${row.earlyDepartures.length}</td>
                  <td>
                    ${row.earlyDepartures.map((event) => `${event.date.slice(5)} ${event.flightNo} ${event.cutoffTime}`).join("、") || "-"}
                  </td>
                  <td>${row.afternoonRestDates.length}</td>
                  <td>
                    ${row.afternoonRestDates.map((eventDate) => eventDate.slice(5)).join("、") || "-"}
                  </td>
                </tr>`
            )}
          </tbody>
        </table>
      </div>
    </section>`;
  }

  private positionStatistics() {
    const statistics = buildMonthlyPositionStatistics(
      this.model,
      this.date,
      TR121_H02_TARGET
    );
    const emptyMessage = !statistics.configured
      ? "尚未配置 TR121 / H02 常规岗位"
      : !statistics.rows.length
        ? "TR121 / H02 尚未配置正常常规资质人员"
        : "";
    return html`<section class="workspace-section monthly-position-statistics">
      <div class="section-heading">
        <div>
          <h3>TR121 / H02 月度承担次数</h3>
          <span
            >${statistics.month} · 当前正常常规资质人员，按次数从少到多</span
          >
        </div>
      </div>
      ${
        emptyMessage
          ? html`<div class="empty-workspace compact-empty">
              <i class="bi bi-bar-chart"></i>
              <p>${emptyMessage}</p>
            </div>`
          : html`<div class="duty-balance-summary">
                <span>资质人员 <strong>${statistics.rows.length}</strong></span
                ><span
                  >最高 / 最低
                  <strong
                    >${statistics.range.max} / ${statistics.range.min}</strong
                  ></span
                ><span
                  >差值 <strong>${statistics.range.difference}</strong></span
                >
              </div>
              <div class="table-responsive">
                <table
                  class="table table-sm align-middle data-table monthly-position-table"
                >
                  <thead>
                    <tr>
                      <th>资质人员</th>
                      <th>本月次数</th>
                      <th>承担日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${statistics.rows.map(
                      (row) =>
                        html`<tr>
                          <td><strong>${row.staff.name}</strong></td>
                          <td>${row.dates.length}</td>
                          <td>
                            ${row.dates.map((item) => item.slice(5)).join("、") || "-"}
                          </td>
                        </tr>`
                    )}
                  </tbody>
                </table>
              </div>`
      }
    </section>`;
  }
}

customElements.define("autoschedule-statistics-page", StatisticsPageElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-statistics-page": StatisticsPageElement;
  }
}
