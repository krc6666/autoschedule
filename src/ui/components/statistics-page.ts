import { html } from "lit";

import {
  buildMonthlyLatePriorityStatistics,
  LATE_PRIORITY_STATISTICS_CATEGORIES,
  latePriorityStatisticsFlightNumbers,
  type LatePriorityStatisticsCategory,
  type MonthlyLatePriorityFlightStatistics,
} from "../../domain/statistics/monthly-late-priority-statistics";
import { buildMonthlyRelaxedShiftStatistics } from "../../domain/statistics/relaxed-shift-statistics";
import type { AppState } from "../../model";
import { LightDomElement } from "./light-dom-element";
import "./duty-roster-details";
import { dispatchUiCommand } from "../events/ui-command";

export class StatisticsPageElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    date: { type: String },
  };
  model!: AppState;
  date = "";
  private readonly expandedLatePriorityCells = new Set<string>();
  private selectedLatePriorityStatisticsMonth = "";

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
      this.latePriorityStatisticsDate()
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
        <div class="late-priority-toolbar">
          <label class="d-inline-flex align-items-center gap-2 mb-0">
            <span class="small text-body-secondary">统计月份</span>
            <input
              class="form-control form-control-sm"
              type="month"
              aria-label="末班重点岗位统计月份"
              .value=${this.latePriorityStatisticsMonth()}
              @change=${(event: Event) =>
                this.selectLatePriorityStatisticsMonth(
                  (event.currentTarget as HTMLInputElement).value
                )}
            />
          </label>
          ${
            flightNumbers.length && statistics.rows.length
              ? html`<button
                    class="btn btn-sm btn-outline-secondary"
                    type="button"
                    title="导入当前月份末班重点岗位次数"
                    @click=${() =>
                      dispatchUiCommand(this, {
                        type: "open-import",
                        mode: "late-priority-counts",
                        date: this.latePriorityStatisticsDate(),
                      })}
                  >
                    <i class="bi bi-file-earmark-arrow-up me-1"></i>导入次数
                  </button>
                  <button
                    class="btn btn-sm btn-outline-secondary"
                    type="button"
                    title="导出当前月份末班重点岗位次数"
                    @click=${() =>
                      dispatchUiCommand(this, {
                        type: "export-late-priority-counts",
                        date: this.latePriorityStatisticsDate(),
                      })}
                  >
                    <i class="bi bi-file-earmark-arrow-down me-1"></i>导出次数
                  </button>
                  <button
                    class="btn btn-sm btn-outline-secondary"
                    type="button"
                    title="清零当前统计月份的末班重点岗位次数；其他月份和历史记录保留"
                    @click=${() =>
                      dispatchUiCommand(this, {
                        type: "reset-monthly-late-priority-frequency-counts",
                        month: statistics.month,
                        date: this.latePriorityStatisticsDate(),
                      })}
                  >
                    <i class="bi bi-arrow-counterclockwise me-1"></i
                    >当月次数清零
                  </button>`
              : ""
          }
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
                        ${flightNumbers.map((flightNo) => html`<th>${flightNo}</th>`)}
                      </tr>
                    </thead>
                    <tbody>
                      ${statistics.rows.map(
                        (row) =>
                          html`<tr>
                            <td data-label="人员">
                              <strong>${row.staff.name}</strong>
                            </td>
                            <td data-label="四类合计">
                              <strong>${row.totalCount}</strong>
                            </td>
                            ${flightNumbers.map(
                              (flightNo) =>
                                html`<td data-label=${flightNo}>
                                  ${this.latePriorityFlightCell(
                                    row.staff.id,
                                    statistics.month,
                                    row.flights[flightNo]!
                                  )}
                                </td>`
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

  private latePriorityFlightCell(
    staffId: string,
    month: string,
    flight: MonthlyLatePriorityFlightStatistics
  ) {
    const detailKey = `${staffId}\u0000${flight.flightNo}`;
    return html`<details
      class="late-priority-count-detail"
      data-staff-id=${staffId}
      data-flight-no=${flight.flightNo}
      .open=${this.expandedLatePriorityCells.has(detailKey)}
      @toggle=${(event: Event) => this.trackLatePriorityDetailToggle(detailKey, (event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary title="展开四类岗位次数">${flight.totalCount}</summary>
      <div class="late-priority-flight-breakdown">
        ${LATE_PRIORITY_STATISTICS_CATEGORIES.map((category) => {
          const own = flight.categories[category];
          return html`<div
            class="late-priority-adjustment-row"
            data-staff-id=${staffId}
            data-late-priority-category=${category}
          >
            <strong>${category}</strong>
            ${
              own.qualified
                ? html`${this.adjustmentButtons(
                      staffId,
                      month,
                      flight.flightNo,
                      category,
                      own.effectiveCount
                    )}<small
                      >实际 ${own.visibleDetails.length} · 修正
                      ${
                        own.manualCorrection >= 0 ? "+" : ""
                      }${own.manualCorrection}</small
                    >`
                : html`<span class="text-body-secondary">无资质</span>`
            }
            ${
              own.visibleDetails.length
                ? html`<small class="late-priority-detail-list"
                    >${own.visibleDetails
                      .map(
                        (detail) => `${detail.date.slice(5)} ${detail.position}`
                      )
                      .join("、")}</small
                  >`
                : ""
            }
          </div>`;
        })}
      </div>
    </details>`;
  }

  private latePriorityStatisticsMonth(): string {
    return this.selectedLatePriorityStatisticsMonth || this.date.slice(0, 7);
  }

  private latePriorityStatisticsDate(): string {
    const month = this.latePriorityStatisticsMonth();
    if (this.model.activeScheduleDate?.startsWith(month))
      return this.model.activeScheduleDate;
    if (this.date.startsWith(month)) return this.date;
    return `${month}-01`;
  }

  private selectLatePriorityStatisticsMonth(month: string): void {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    this.selectedLatePriorityStatisticsMonth = month;
    this.requestUpdate();
  }

  private adjustmentButtons(
    staffId: string,
    month: string,
    flightNo: string,
    category: LatePriorityStatisticsCategory,
    count: number
  ) {
    const kind = (
      {
        督导: "supervisor",
        一号: "number-one",
        申报: "declaration",
        送资料: "delivery",
      } as const
    )[category];
    return html`<span class="late-priority-adjustments">
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        aria-label="${flightNo}${category}减少一次"
        @click=${() => dispatchUiCommand(this, { type: "adjust-late-priority-frequency", month, staffId, flightNo, kind, delta: -1 })}
      >
        −
      </button>
      <output aria-label="${flightNo}${category}最终次数">${count}</output>
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary"
        aria-label="${flightNo}${category}增加一次"
        @click=${() => dispatchUiCommand(this, { type: "adjust-late-priority-frequency", month, staffId, flightNo, kind, delta: 1 })}
      >
        +
      </button>
    </span>`;
  }

  private trackLatePriorityDetailToggle(key: string, open: boolean): void {
    if (open) {
      this.expandedLatePriorityCells.add(key);
    } else {
      this.expandedLatePriorityCells.delete(key);
    }
  }
}

customElements.define("autoschedule-statistics-page", StatisticsPageElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-statistics-page": StatisticsPageElement;
  }
}
