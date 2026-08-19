import { html } from "lit";

import type { ArchivedScheduleDayView } from "../projections/archived-schedule-view";
import { LightDomElement } from "./light-dom-element";
import "./archived-schedule-board";

export class PreviousScheduleComparisonElement extends LightDomElement {
  static override properties = { view: { attribute: false } };
  view!: ArchivedScheduleDayView;

  protected override render() {
    return html`<section
      class="previous-schedule-comparison"
      aria-label="上一班班表对照"
    >
      <div class="previous-schedule-comparison-heading">
        <div>
          <h3>上一班班表</h3>
          <span
            >${this.view.date} · ${this.view.groups.length} 个航班 ·
            ${this.view.recordCount} 个岗位</span
          >
        </div>
        <span
          >${this.view.totalHours.toFixed(1)}
          ${this.view.hasPartialHistory ? "已知工时（仅末班重点记录）" : "总工时"}</span
        >
      </div>
      <autoschedule-archived-schedule-board
        .view=${this.view}
      ></autoschedule-archived-schedule-board>
    </section>`;
  }
}

customElements.define(
  "autoschedule-previous-schedule-comparison",
  PreviousScheduleComparisonElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-previous-schedule-comparison": PreviousScheduleComparisonElement;
  }
}
