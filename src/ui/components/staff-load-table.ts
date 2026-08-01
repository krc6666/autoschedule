import { html } from "lit";

import type {
  LoadSortDirection,
  LoadSortField,
  SchedulePageModel,
} from "../projections/schedule-page-model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class StaffLoadTableElement extends LightDomElement {
  static override properties = {
    view: { attribute: false },
    field: { type: String },
    direction: { type: String },
  };
  view!: SchedulePageModel;
  field: LoadSortField = "totalFatigue";
  direction: LoadSortDirection = "desc";

  protected override render() {
    return html`<details class="workspace-section load-details">
      <summary>人员负荷与疲劳</summary>
      <div class="load-sort-controls">
        <select
          class="form-select form-select-sm"
          aria-label="负荷排序字段"
          .value=${this.field}
          @change=${(event: Event) => this.changeField((event.currentTarget as HTMLSelectElement).value as LoadSortField)}
        >
          <option value="workHours">当日工时</option>
          <option value="todayFatigue">岗位疲劳</option>
          <option value="historyFatigue">历史疲劳</option>
          <option value="totalFatigue">总疲劳</option>
        </select>
        <select
          class="form-select form-select-sm"
          aria-label="负荷排序方向"
          .value=${this.direction}
          @change=${(event: Event) => this.changeDirection((event.currentTarget as HTMLSelectElement).value as LoadSortDirection)}
        >
          <option value="desc">从高到低</option>
          <option value="asc">从低到高</option>
        </select>
      </div>
      <div class="table-responsive mt-2">
        <table class="table table-sm align-middle data-table">
          <thead>
            <tr>
              <th>人员</th>
              <th>状态</th>
              <th>当日工时</th>
              <th>岗位疲劳</th>
              <th>历史疲劳</th>
              <th>总疲劳</th>
            </tr>
          </thead>
          <tbody>
            ${this.view.loads.map(
              (load) =>
                html`<tr>
                  <td>${load.staff.name}</td>
                  <td>${load.staff.status}</td>
                  <td>${load.workHours.toFixed(1)}h</td>
                  <td>${load.todayFatigue.toFixed(1)}</td>
                  <td>${load.historyFatigue.toFixed(1)}</td>
                  <td>
                    <span
                      class="badge ${load.totalFatigue >= 20 ? "text-bg-danger" : load.totalFatigue >= 10 ? "text-bg-warning" : "text-bg-success"}"
                      >${load.totalFatigue.toFixed(1)}</span
                    >
                  </td>
                </tr>`
            )}
          </tbody>
        </table>
      </div>
    </details>`;
  }

  private changeField(field: LoadSortField): void {
    dispatchUiCommand(this, {
      type: "set-load-sort",
      field,
      direction: this.direction,
    });
  }

  private changeDirection(direction: LoadSortDirection): void {
    dispatchUiCommand(this, {
      type: "set-load-sort",
      field: this.field,
      direction,
    });
  }
}

customElements.define("autoschedule-staff-load-table", StaffLoadTableElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-staff-load-table": StaffLoadTableElement;
  }
}
