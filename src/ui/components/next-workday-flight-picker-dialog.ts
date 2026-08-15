import { html } from "lit";

import type { ApplicationDialog } from "../../app/application-view-state";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";
import { weekdayLabel } from "../../domain/flights/weekly-flight-plan";

type PickerDialog = Extract<
  ApplicationDialog,
  { kind: "next-workday-flight-picker" }
>;

export class NextWorkdayFlightPickerDialogElement extends LightDomElement {
  static override properties = { dialog: { attribute: false } };
  dialog!: PickerDialog;

  protected override render() {
    const selected = new Set(this.dialog.selectedIds);
    const selectedCount = this.dialog.selectedIds.length;
    return html`<div class="modal-body next-workday-flight-picker">
        <div class="d-flex flex-wrap gap-2 mb-3">
          ${this.quickAction(
          `恢复${weekdayLabel(this.dialog.weekday)}预设`,
          this.restorePreset
        )}
          ${this.quickAction("全选", this.selectAll)}
          ${this.quickAction("清空", this.clearAll)}
        </div>
        ${
        this.dialog.candidates.length
          ? html`<div class="list-group next-workday-flight-list">
              ${this.dialog.candidates.map(
              (candidate) =>
                html`<label
                  class="list-group-item list-group-item-action d-flex align-items-center gap-3"
                >
                  <input
                    class="form-check-input flex-shrink-0"
                    type="checkbox"
                    .checked=${selected.has(candidate.id)}
                    @change=${(event: Event) =>
                    this.toggle(
                      candidate.id,
                      (event.currentTarget as HTMLInputElement).checked
                    )}
                  />
                  <span class="flex-grow-1 min-w-0">
                    <strong>${candidate.flightNo}</strong>
                    <small class="text-secondary ms-2"
                      >${candidate.startTime}-${candidate.endTime}</small
                    >
                  </span>
                  <span class="badge text-bg-light flex-shrink-0"
                    >${candidate.positions.length} 岗</span
                  >
                </label>`
            )}
            </div>`
          : html`<div class="empty-state">尚无可选择的本地航班</div>`
      }
        <div class="small text-secondary mt-3">
          已选择 ${selectedCount} 个航班
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-bs-dismiss="modal">
          取消
        </button>
        <button
          class="btn btn-success"
          type="button"
          ?disabled=${selectedCount === 0}
          @click=${this.confirm}
        >
          <i class="bi bi-calendar2-check me-1"></i>归档并生成后天排班
        </button>
      </div>`;
  }

  private quickAction(label: string, action: () => void) {
    return html`<button
      class="btn btn-sm btn-outline-secondary"
      type="button"
      @click=${action}
    >
      ${label}
    </button>`;
  }

  private toggle(id: string, checked: boolean): void {
    const selected = new Set(this.dialog.selectedIds);
    checked ? selected.add(id) : selected.delete(id);
    this.dispatchSelection([...selected]);
  }

  private restorePreset = (): void => {
    this.dispatchSelection(
      this.dialog.candidates
        .filter((candidate) => candidate.selectedByDefault)
        .map((candidate) => candidate.id)
    );
  };

  private selectAll = (): void => {
    this.dispatchSelection(
      this.dialog.candidates.map((candidate) => candidate.id)
    );
  };

  private clearAll = (): void => this.dispatchSelection([]);

  private dispatchSelection(selectedIds: string[]): void {
    dispatchUiCommand(this, {
      type: "update-next-workday-flight-picker-selection",
      selectedIds,
    });
  }

  private confirm = (): void => {
    if (!this.dialog.selectedIds.length) return;
    dispatchUiCommand(this, {
      type: "confirm-next-workday-flight-picker",
      selectedIds: this.dialog.selectedIds,
    });
  };
}

customElements.define(
  "autoschedule-next-workday-flight-picker",
  NextWorkdayFlightPickerDialogElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-next-workday-flight-picker": NextWorkdayFlightPickerDialogElement;
  }
}
