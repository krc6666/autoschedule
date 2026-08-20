import { html } from "lit";

import type { ApplicationDialog } from "../../app/application-view-state";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

type CountsImportDialog = Extract<
  ApplicationDialog,
  { kind: "late-priority-counts-import" }
>;

export class LatePriorityCountsImportDialogElement extends LightDomElement {
  static override properties = { dialog: { attribute: false } };
  dialog!: CountsImportDialog;

  protected override render() {
    const preview = this.dialog.preview;
    return html`<div class="modal-body">
        <div class="row g-2 mb-3">
          <div class="col-sm-4">
            <div class="small text-secondary">统计月份</div>
            <strong>${preview.month}</strong>
          </div>
          <div class="col-sm-4">
            <div class="small text-secondary">航班范围</div>
            <strong>${preview.flightNumbers.join("、") || "无"}</strong>
          </div>
          <div class="col-sm-4">
            <div class="small text-secondary">次数项目</div>
            <strong>${preview.targets.length} 项</strong>
          </div>
        </div>
        <div class="alert alert-info py-2">
          确认后覆盖该月份文件内航班的四类最终次数；其他月份和其他航班保留。
        </div>
        ${preview.errors.map(
          (message) =>
            html`<div class="alert alert-danger py-2 mb-2">
              <i class="bi bi-exclamation-circle me-2"></i>${message}
            </div>`
        )}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-bs-dismiss="modal">
          取消
        </button>
        <button
          class="btn btn-primary"
          type="button"
          ?disabled=${!preview.canApply}
          @click=${() =>
            dispatchUiCommand(this, {
              type: "apply-late-priority-counts-import",
            })}
        >
          <i class="bi bi-check2 me-1"></i>确认导入
        </button>
      </div>`;
  }
}

customElements.define(
  "autoschedule-late-priority-counts-import-dialog",
  LatePriorityCountsImportDialogElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-late-priority-counts-import-dialog": LatePriorityCountsImportDialogElement;
  }
}
