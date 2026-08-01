import { html } from "lit";

import type { AppState } from "../../model";
import { dispatchUiCommand, inputValue } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class FlightsPageElement extends LightDomElement {
  static override properties = { model: { attribute: false } };
  model!: AppState;

  protected override render() {
    const flights = [...this.model.flights].sort((left, right) =>
      left.startTime.localeCompare(right.startTime)
    );
    return html`<section class="workspace-section">
      <div class="section-heading">
        <div>
          <h3>当日航班计划</h3>
          <span>输入航班号会自动带出配置模板；预定人数决定启用多少岗位</span>
        </div>
        <div class="d-flex flex-wrap gap-2">
          ${this.actionButton("cloud-download", "在线查询航班", "open-flight-query", "btn-outline-primary")}
          ${this.actionButton("copy", "选择模板", "open-flight-templates", "btn-outline-secondary")}
          ${this.actionButton("plus-lg", "新增当日航班", "add-flight", "btn-primary")}
        </div>
      </div>
      <div class="table-responsive">
        <table class="table align-middle data-table">
          <thead>
            <tr>
              <th>航班号</th>
              <th>时间</th>
              <th>预定人数（运力）</th>
              <th>岗位清单</th>
              <th>备注</th>
              <th class="action-col">
                <span class="visually-hidden">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${
              flights.length
                ? flights.map(
                    (flight) =>
                      html`<tr>
                        <td>
                          ${this.field(flight.id, "flightNo", flight.flightNo, "航班号", "text", "code-input", "flight-template-options")}
                        </td>
                        <td>
                          <div class="time-range">
                            ${this.field(flight.id, "startTime", flight.startTime, "开始时间", "time")}
                            <span>至</span>
                            ${this.field(flight.id, "endTime", flight.endTime, "结束时间", "time")}
                          </div>
                        </td>
                        <td>
                          ${this.field(flight.id, "bookedPassengers", flight.bookedPassengers, "预定人数", "number", "number-input")}
                        </td>
                        <td>
                          ${this.field(flight.id, "positions", flight.positions.join(", "), "涉及岗位", "text", "wide-input")}
                        </td>
                        <td>
                          ${this.field(flight.id, "remark", flight.remark, "备注")}
                        </td>
                        <td>
                          <button
                            class="btn btn-sm btn-outline-danger icon-btn"
                            type="button"
                            title="删除航班"
                            aria-label="删除航班"
                            @click=${() => dispatchUiCommand(this, { type: "delete-flight", id: flight.id })}
                          >
                            <i class="bi bi-trash3"></i>
                          </button>
                        </td>
                      </tr>`
                  )
                : html`<tr>
                    <td colspan="6" class="empty-cell">尚无航班计划</td>
                  </tr>`
            }
          </tbody>
        </table>
      </div>
      <datalist id="flight-template-options">
        ${this.model.templates.map(
          (template) =>
            html`<option value=${template.flightNo}>
              ${template.startTime}–${template.endTime}
            </option>`
        )}
      </datalist>
    </section>`;
  }

  private field(
    id: string,
    field: string,
    value: string | number,
    label: string,
    type = "text",
    extraClass = "",
    list?: string
  ) {
    return html`<input
      class="form-control form-control-sm ${extraClass}"
      type=${type}
      .value=${String(value)}
      list=${list ?? ""}
      min=${type === "number" ? "0" : ""}
      aria-label=${label}
      @change=${(event: Event) =>
        dispatchUiCommand(this, {
          type: "update-configuration",
          entity: "flight",
          id,
          field,
          value: inputValue(event.currentTarget as HTMLInputElement),
        })}
    />`;
  }

  private actionButton(
    icon: string,
    label: string,
    type: "open-flight-query" | "open-flight-templates" | "add-flight",
    style: string
  ) {
    return html`<button
      class="btn ${style}"
      type="button"
      @click=${() => dispatchUiCommand(this, { type })}
    >
      <i class="bi bi-${icon} me-2"></i>${label}
    </button>`;
  }
}

customElements.define("autoschedule-flights-page", FlightsPageElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-flights-page": FlightsPageElement;
  }
}
