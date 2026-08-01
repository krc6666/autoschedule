import Modal from "bootstrap/js/dist/modal";
import { html, nothing, type PropertyValues } from "lit";
import { createRef, ref, type Ref } from "lit/directives/ref.js";

import type { ApplicationDialog } from "../../app/application-view-state";
import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";
import "./duty-roster-import-dialog";
import "./flight-query-dialog";
import "./qualification-dialog";
import "./template-picker-dialog";

export class AppDialogElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    dialog: { attribute: false },
  };
  model!: AppState;
  dialog: ApplicationDialog | null = null;
  private readonly modalRef: Ref<HTMLDivElement> = createRef();

  protected override render() {
    return html`<div
      ${ref(this.modalRef)}
      class="modal fade"
      tabindex="-1"
      aria-hidden="true"
      @hidden.bs.modal=${this.closed}
    >
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title fs-5">${this.titleText()}</h2>
            <button
              type="button"
              class="btn-close"
              data-bs-dismiss="modal"
              aria-label="关闭"
            ></button>
          </div>
          ${this.content()}
        </div>
      </div>
    </div>`;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("dialog") || !this.modalRef.value) return;
    const instance = Modal.getOrCreateInstance(this.modalRef.value);
    if (this.dialog) instance.show();
    else instance.hide();
  }

  private titleText(): string {
    const dialog = this.dialog;
    if (dialog?.kind === "templates") return "从模板添加航班";
    if (dialog?.kind === "qualification") {
      const rule = this.model.positionRules.find(
        (item) => item.id === dialog.positionRuleId
      );
      return rule ? `${rule.flightNo} / ${rule.name} 资质` : "岗位资质";
    }
    if (dialog?.kind === "flight-query") return "在线查询航班";
    if (dialog?.kind === "duty-roster-import") return "值班备勤表导入预览";
    return "";
  }

  private content() {
    const dialog = this.dialog;
    if (dialog?.kind === "templates")
      return html`<autoschedule-template-picker
        .model=${this.model}
      ></autoschedule-template-picker>`;
    if (dialog?.kind === "qualification")
      return html`<autoschedule-qualification-dialog
        .model=${this.model}
        .positionRuleId=${dialog.positionRuleId}
      ></autoschedule-qualification-dialog>`;
    if (dialog?.kind === "flight-query")
      return html`<autoschedule-flight-query-dialog
        .dialog=${dialog}
      ></autoschedule-flight-query-dialog>`;
    if (dialog?.kind === "duty-roster-import")
      return html`<autoschedule-duty-roster-import-dialog
        .model=${this.model}
        .preview=${dialog.preview}
      ></autoschedule-duty-roster-import-dialog>`;
    return nothing;
  }

  private closed(): void {
    if (this.dialog) dispatchUiCommand(this, { type: "close-dialog" });
  }
}

customElements.define("autoschedule-app-dialog", AppDialogElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-app-dialog": AppDialogElement;
  }
}
