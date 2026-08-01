import { html } from "lit";

import { getDutyRosterForDate } from "../../domain/duty-roster/roster";
import { addIsoDays } from "../../domain/shared/time";
import type { AppState } from "../../model";
import { LightDomElement } from "./light-dom-element";

export class DutyRosterSummaryElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    date: { type: String },
  };
  model!: AppState;
  date = "";

  protected override render() {
    const current = getDutyRosterForDate(this.model, this.date);
    return html`<aside class="duty-roster-summary" aria-label="当日轮值">
      <div class="duty-roster-summary-head">
        <div>
          <h3>当日轮值</h3>
          <span>${this.date}</span>
        </div>
        <i class="bi bi-person-check"></i>
      </div>
      <div class="duty-roster-cards">
        <article class="duty-roster-card is-cx">
          <span><i class="bi bi-airplane-engines"></i>CX航前</span
          ><strong>${this.name(current.cxPreflightStaffId)}</strong>
        </article>
        <article class="duty-roster-card is-duty">
          <span><i class="bi bi-person-workspace"></i>值班人员</span
          ><strong>${this.name(current.dutyStaffId)}</strong
          ><small
            ><i class="bi bi-activity"></i>本次值班
            +${this.model.settings.dutyFatiguePoints} 疲劳点</small
          >
        </article>
        <article class="duty-roster-card is-standby">
          <span><i class="bi bi-people"></i>次日备勤人员</span
          ><strong
            >${current.standbyStaffIds.map((staffId) => this.name(staffId)).join("、")}</strong
          ><small>${addIsoDays(this.date, 1)}</small>
        </article>
      </div>
    </aside>`;
  }

  private name(staffId: string | null): string {
    return staffId
      ? (this.model.staff.find((person) => person.id === staffId)?.name ??
          `#${staffId}`)
      : "未配置";
  }
}

customElements.define(
  "autoschedule-duty-roster-summary",
  DutyRosterSummaryElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-duty-roster-summary": DutyRosterSummaryElement;
  }
}
