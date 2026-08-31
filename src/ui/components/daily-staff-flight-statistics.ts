import { html, type PropertyValues } from "lit";

import { buildDailyStaffFlightStatistics } from "../../domain/statistics/daily-staff-flight-statistics";
import type { AppState } from "../../model";
import { LightDomElement } from "./light-dom-element";

export class DailyStaffFlightStatisticsElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    date: { type: String },
  };
  model!: AppState;
  date = "";
  private queryDate = "";

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (!changedProperties.has("date")) return;
    const previousDate = changedProperties.get("date");
    if (!this.queryDate || this.queryDate === previousDate)
      this.queryDate = this.date;
  }

  protected override render() {
    const statistics = buildDailyStaffFlightStatistics(
      this.model,
      this.queryDate || this.date
    );
    return html`<section
      class="workspace-section daily-staff-flight-statistics"
      aria-label="人员当日航班"
    >
      <div class="daily-staff-flight-head">
        <div>
          <h3>人员当日航班</h3>
          <span>仅显示常规人员，同一航班只统计一次</span>
        </div>
        <label>
          <span>查询工作日</span>
          <input
            class="form-control form-control-sm"
            type="date"
            aria-label="人员航班查询日期"
            .value=${statistics.date}
            @change=${this.changeDate}
          />
        </label>
      </div>
      ${
        statistics.source === "current" || statistics.source === "history"
          ? html`<div class="daily-staff-flight-summary">
              <strong>${statistics.assignedStaffCount} 人有航班</strong>
              <span>${statistics.unassignedStaffCount} 人未安排</span>
            </div>`
          : null
      }
      ${this.result(statistics)}
    </section>`;
  }

  private result(
    statistics: ReturnType<typeof buildDailyStaffFlightStatistics>
  ) {
    if (statistics.source === "partial-history") {
      return html`<div class="daily-staff-flight-message" role="status">
        <i class="bi bi-exclamation-triangle"></i>
        该工作日只有末班重点记录，无法还原全天人员航班。
      </div>`;
    }
    if (statistics.source === "none") {
      return html`<div class="daily-staff-flight-message" role="status">
        <i class="bi bi-calendar2-x"></i>该工作日没有完整排班记录。
      </div>`;
    }
    if (!statistics.rows.length) {
      return html`<div class="daily-staff-flight-message" role="status">
        <i class="bi bi-calendar2-check"></i>该工作日没有常规人员航班。
      </div>`;
    }
    return html`<div class="daily-staff-flight-tags">
      ${statistics.rows.map(
        (row) =>
          html`<span class="daily-staff-flight-tag" data-staff-id=${row.staffId}
            ><strong>${row.staffName}</strong>
            ${row.flightNumbers.join("、")}</span
          >`
      )}
    </div>`;
  }

  private changeDate(event: Event): void {
    this.queryDate = (event.currentTarget as HTMLInputElement).value;
    this.requestUpdate();
  }
}

customElements.define(
  "autoschedule-daily-staff-flight-statistics",
  DailyStaffFlightStatisticsElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-daily-staff-flight-statistics": DailyStaffFlightStatisticsElement;
  }
}
