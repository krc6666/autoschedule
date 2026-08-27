import { html } from "lit";

import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class HalfRestSelectorElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    selectedStaffIds: { attribute: false },
  };

  model!: AppState;
  selectedStaffIds: string[] = [];

  protected override render() {
    const staff = this.model.staff.filter(
      (person) => person.status === "正常" && person.staffType === "常规"
    );
    const selected = new Set(this.selectedStaffIds);
    return html`<details class="half-rest-selector">
      <summary class="btn btn-sm btn-outline-secondary">
        <i class="bi bi-clock-history me-1"></i>半休人员
        ${
          selected.size
            ? html`<span class="badge text-bg-danger ms-1"
                >${selected.size}</span
              >`
            : null
        }
      </summary>
      <div class="half-rest-menu" role="group" aria-label="半休人员多选">
        ${staff.map(
          (person) =>
            html`<label class="half-rest-option">
              <input
                class="form-check-input"
                type="checkbox"
                value=${person.id}
                aria-label="${person.name}设为半休"
                .checked=${selected.has(person.id)}
                @change=${this.changeSelection}
              />
              <span>${person.name}</span>
            </label>`
        )}
      </div>
    </details>`;
  }

  private changeSelection(): void {
    const staffIds = [
      ...this.querySelectorAll<HTMLInputElement>(
        '.half-rest-menu input[type="checkbox"]:checked'
      ),
    ].map((input) => input.value);
    dispatchUiCommand(this, { type: "set-half-rest-staff", staffIds });
  }
}

customElements.define(
  "autoschedule-half-rest-selector",
  HalfRestSelectorElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-half-rest-selector": HalfRestSelectorElement;
  }
}
