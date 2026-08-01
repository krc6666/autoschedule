import { html } from "lit";

import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class QualificationDialogElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    positionRuleId: { type: String },
  };
  model!: AppState;
  positionRuleId = "";
  private sourceRuleId = "";
  private manual = false;
  private selectedIds = new Set<string>();

  protected override render() {
    const rule = this.model.positionRules.find(
      (item) => item.id === this.positionRuleId
    );
    if (!rule)
      return html`<div class="modal-body">
        <div class="alert alert-danger mb-0">岗位规则已不存在</div>
      </div>`;
    if (this.sourceRuleId !== rule.id) {
      this.sourceRuleId = rule.id;
      this.manual = rule.manual;
      this.selectedIds = new Set(rule.qualifiedStaffIds);
    }
    return html`<div class="modal-body">
        <div
          class="d-flex align-items-center justify-content-between gap-2 border-bottom pb-3 mb-3"
        >
          <label class="form-check form-switch m-0">
            <input
              class="form-check-input"
              type="checkbox"
              .checked=${this.manual}
              @change=${this.changeManual}
            />
            <span class="form-check-label">手动补位岗位</span>
          </label>
          <div class="btn-group btn-group-sm">
            <button
              class="btn btn-outline-secondary"
              type="button"
              @click=${() => this.selectAll(true)}
            >
              <i class="bi bi-check2-square me-1"></i>全选
            </button>
            <button
              class="btn btn-outline-secondary"
              type="button"
              @click=${() => this.selectAll(false)}
            >
              <i class="bi bi-square me-1"></i>全不选
            </button>
          </div>
        </div>
        <div class="qualified-grid">
          ${this.model.staff.map(
            (person) =>
              html`<label class="form-check qualified-check">
                <input
                  class="form-check-input"
                  type="checkbox"
                  .checked=${this.selectedIds.has(person.id)}
                  @change=${(event: Event) => this.toggle(person.id, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span class="form-check-label"
                  >${person.name}
                  <small>#${person.id} · ${person.staffType}</small></span
                >
              </label>`
          )}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-bs-dismiss="modal">
          取消
        </button>
        <button class="btn btn-primary" type="button" @click=${this.save}>
          保存
        </button>
      </div>`;
  }

  private changeManual(event: Event): void {
    this.manual = (event.currentTarget as HTMLInputElement).checked;
    this.requestUpdate();
  }

  private selectAll(checked: boolean): void {
    this.selectedIds = checked
      ? new Set(this.model.staff.map((person) => person.id))
      : new Set();
    this.requestUpdate();
  }

  private toggle(id: string, checked: boolean): void {
    const selected = new Set(this.selectedIds);
    if (checked) selected.add(id);
    else selected.delete(id);
    this.selectedIds = selected;
    this.requestUpdate();
  }

  private save(): void {
    dispatchUiCommand(this, {
      type: "save-qualification",
      id: this.positionRuleId,
      manual: this.manual,
      staffIds: [...this.selectedIds],
    });
  }
}

customElements.define(
  "autoschedule-qualification-dialog",
  QualificationDialogElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-qualification-dialog": QualificationDialogElement;
  }
}
