import { html } from "lit";

import type { AppState } from "../../model";
import type { HalfRestMode } from "../../domain/shared/schedule-run-preferences";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class HalfRestSelectorElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    selectedStaffIds: { attribute: false },
    selectedModes: { attribute: false },
  };

  model!: AppState;
  selectedStaffIds: string[] = [];
  selectedModes: Record<string, HalfRestMode> = {};

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
              <select
                class="form-select form-select-sm half-rest-mode"
                data-staff-id=${person.id}
                aria-label="${person.name}半休时段"
                .value=${this.selectedModes[person.id] ?? "early-finish"}
                @change=${this.changeSelection}
              >
                <option value="early-finish">下午半休（尽早下班）</option>
                <option value="late-start">上午半休（晚到班）</option>
              </select>
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
    const modes = Object.fromEntries(
      staffIds.map((staffId) => {
        const select = this.querySelector<HTMLSelectElement>(
          `select[data-staff-id="${staffId}"]`
        );
        return [staffId, (select?.value as HalfRestMode) ?? "early-finish"];
      })
    ) as Record<string, HalfRestMode>;
    dispatchUiCommand(this, { type: "set-half-rest-staff", staffIds, modes });
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
