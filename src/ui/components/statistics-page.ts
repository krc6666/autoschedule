import { html } from "lit";

import {
  buildMonthlyLatePriorityStatistics,
  LATE_PRIORITY_STATISTICS_CATEGORIES,
  latePriorityStatisticsFlightNumbers,
  type LatePriorityStatisticsDetail,
  type LatePriorityStatisticsCategory,
} from "../../domain/statistics/monthly-late-priority-statistics";
import { buildMonthlyRelaxedShiftStatistics } from "../../domain/statistics/relaxed-shift-statistics";
import type { AppState } from "../../model";
import { LightDomElement } from "./light-dom-element";
import "./duty-roster-details";

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
      ${this.relaxedShiftStatistics()} ${this.latePriorityStatistics()}
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

  private latePriorityStatistics() {
    const flightNumbers = latePriorityStatisticsFlightNumbers(this.model);
    const statistics = buildMonthlyLatePriorityStatistics(
      this.model,
      this.date
    );
    return html`<section
      class="workspace-section late-priority-statistics"
      data-late-priority-flights=${flightNumbers.join(",")}
    >
      <div class="section-heading">
        <div>
          <h3>末班重点岗位统计</h3>
          <span
            >${statistics.month} ·
            当前统计航班：${flightNumbers.join("、") || "尚未选择"} ·
            实际结束晚于 ${this.model.settings.lateShiftEndTime}</span
          >
        </div>
      </div>
      ${
        flightNumbers.length
          ? statistics.rows.length
            ? html`${this.latePriorityRangeSummary(statistics.ranges)}
                <div class="table-responsive">
                  <table
                    class="table table-sm align-middle data-table late-priority-summary-table"
                  >
                    <thead>
                      <tr>
                        <th>人员</th>
                        <th>四类合计</th>
                        ${LATE_PRIORITY_STATISTICS_CATEGORIES.map((category) => html`<th>${category}</th>`)}
                      </tr>
                    </thead>
                    <tbody>
                      ${statistics.rows.map(
                        (row) =>
                          html`<tr>
                            <td><strong>${row.staff.name}</strong></td>
                            <td>
                              ${this.latePriorityDetailCell(
                            row.totalCount,
                            LATE_PRIORITY_STATISTICS_CATEGORIES.flatMap(
                              (category) =>
                                row.categories[category].details.map(
                                  (detail) => ({ ...detail, category })
                                )
                            )
                          )}
                            </td>
                            ${LATE_PRIORITY_STATISTICS_CATEGORIES.map(
                            (category) => {
                              const own = row.categories[category];
                              return html`<td>
                                ${
                                  own.qualified
                                    ? this.latePriorityDetailCell(
                                        own.details.length,
                                        own.details.map((detail) => ({
                                          ...detail,
                                          category,
                                        }))
                                      )
                                    : html`<span class="text-body-secondary"
                                        >-</span
                                      >`
                                }
                              </td>`;
                            }
                          )}
                          </tr>`
                      )}
                    </tbody>
                  </table>
                </div>`
            : html`<div class="empty-workspace compact-empty">
                <i class="bi bi-bar-chart"></i>
                <p>当前范围没有正常常规资质人员</p>
              </div>`
          : html`<div class="empty-workspace compact-empty">
              <i class="bi bi-bar-chart"></i>
              <p>尚未选择统计航班，请先到规则页勾选</p>
            </div>`
      }
    </section>`;
  }

  private latePriorityRangeSummary(
    ranges: Record<
      LatePriorityStatisticsCategory,
      {
        min: number;
        max: number;
        difference: number;
        allowedDifference: number;
      }
    >
  ) {
    return html`<div class="duty-balance-summary late-priority-range-summary">
      ${LATE_PRIORITY_STATISTICS_CATEGORIES.map(
        (category) =>
          html`<span
            >${category}最高 / 最低
            <strong>${ranges[category].max} / ${ranges[category].min}</strong>
            <small>允许差值 ${ranges[category].allowedDifference}</small></span
          >`
      )}
    </div>`;
  }

  private latePriorityDetailCell(
    count: number,
    details: readonly (LatePriorityStatisticsDetail & {
      category: LatePriorityStatisticsCategory;
    })[]
  ) {
    return html`<details class="late-priority-count-detail">
      <summary title="查看航班和日期">${count}</summary>
      <div>
        ${
          details.length
            ? details.map(
                (detail) =>
                  html`<span
                    ><strong>${detail.date.slice(5)}</strong> ${detail.flightNo}
                    / ${detail.position} / ${detail.category}</span
                  >`
              )
            : html`<span class="text-body-secondary">本月暂无记录</span>`
        }
      </div>
    </details>`;
  }
}

customElements.define("autoschedule-statistics-page", StatisticsPageElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-statistics-page": StatisticsPageElement;
  }
}
