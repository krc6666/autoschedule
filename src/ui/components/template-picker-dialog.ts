import { html } from "lit";

import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class TemplatePickerDialogElement extends LightDomElement {
  static override properties = { model: { attribute: false } };
  model!: AppState;

  protected override render() {
    return html`<div class="modal-body">
        ${
          this.model.templates.length
            ? html`<div class="list-group">
                ${this.model.templates.map(
                  (template) =>
                    html`<button
                      class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                      type="button"
                      @click=${() =>
                        dispatchUiCommand(this, {
                          type: "add-template-flight",
                          id: template.id,
                        })}
                    >
                      <span
                        ><strong>${template.flightNo}</strong
                        ><small class="text-secondary ms-3"
                          >${template.startTime}-${template.endTime}</small
                        ></span
                      >
                      <span class="badge text-bg-light"
                        >${template.positions.length} 岗</span
                      >
                    </button>`
                )}
              </div>`
            : html`<div class="empty-state">尚无航班模板</div>`
        }
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-bs-dismiss="modal">
          关闭
        </button>
      </div>`;
  }
}

customElements.define(
  "autoschedule-template-picker",
  TemplatePickerDialogElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-template-picker": TemplatePickerDialogElement;
  }
}
