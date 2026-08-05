import { html } from "lit";

import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import {
  buildArchivedScheduleDays,
  type ArchivedScheduleDayView,
} from "../projections/archived-schedule-view";
import "./archived-schedule-board";
import { LightDomElement } from "./light-dom-element";

export class HistoryPageElement extends LightDomElement {
  static override properties = { model: { attribute: false } };
  model!: AppState;
  private readonly expandedDates = new Set<string>();
  private newestDate: string | null = null;

  protected override render() {
    const days = buildArchivedScheduleDays(this.model);
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

  private syncExpandedDates(days: readonly ArchivedScheduleDayView[]): void {
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

  private day(day: ArchivedScheduleDayView) {
    const expanded = this.expandedDates.has(day.date);
    return html`<details
      class="history-day"
      .open=${expanded}
      @toggle=${(event: Event) => this.toggleDay(day.date, event)}
    >
      <summary>
        <span
          ><strong>${day.date}</strong
          ><small
            >${day.groups.length} 个航班 · ${day.recordCount} 个岗位 ·
            ${day.totalHours.toFixed(1)} 总工时</small
          ></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      ${
        expanded
          ? html`<autoschedule-archived-schedule-board
              .view=${day}
              .allowDelete=${true}
            ></autoschedule-archived-schedule-board>`
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
}

customElements.define("autoschedule-history-page", HistoryPageElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-history-page": HistoryPageElement;
  }
}
