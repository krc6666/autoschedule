import { html } from "lit";

import type { ApplicationDialog } from "../../app/application-view-state";
import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

type WorkbookImportDialog = Extract<
  ApplicationDialog,
  { kind: "workbook-import" }
>;

export class WorkbookImportDialogElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    dialog: { attribute: false },
  };

  model!: AppState;
  dialog!: WorkbookImportDialog;

  protected override render() {
    const imported = this.dialog.importedState;
    const settings = imported.settings;
    return html`<div class="modal-body">
        <div class="alert alert-warning py-2">
          <i class="bi bi-exclamation-triangle me-2"></i>
          确认导入后会替换识别到的配置，并清空当前尚未归档的排班结果。
        </div>
        <div class="row g-2 mb-3">
          ${this.summary("导入模式", this.dialog.mode)}
          ${this.summary("识别内容", this.dialog.recognized || "无有效数据")}
          ${this.summary("人员", `${imported.staff.length} 人`)}
          ${this.summary("岗位规则", `${imported.positionRules.length} 条`)}
          ${this.summary(
            "结构化规则",
            `${
              settings.positionTransitionPolicies.length +
              settings.dutyPositionPriorities.length +
              settings.nextWorkdayRecoveryTargets.length +
              settings.lateShiftRecoveryPositionRules.length +
              settings.mobileSupervisorCoverageRules.length +
              settings.crossWorkdayQualificationReservations.length
            } 条`
          )}
        </div>
        <div class="border rounded p-3 mb-3">
          <strong>末班重点航班范围</strong>
          <div class="small text-secondary mt-1">
            ${
              settings.latePriorityFlightNumbers.length
                ? settings.latePriorityFlightNumbers.join("、")
                : "当前为空，导入后停用这组范围保护"
            }
          </div>
        </div>
        ${this.dialog.warnings.map(
          (message) =>
            html`<div class="alert alert-warning py-2 mb-2">
              <i class="bi bi-exclamation-triangle me-2"></i>${message}
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
          ?disabled=${!this.dialog.recognized}
          @click=${() =>
            dispatchUiCommand(this, { type: "apply-workbook-import" })}
        >
          <i class="bi bi-check2 me-1"></i>确认导入并重新排班
        </button>
      </div>`;
  }

  private summary(label: string, value: string) {
    return html`<div class="col-md-4">
      <div class="small text-secondary">${label}</div>
      <div class="fw-semibold text-break">${value}</div>
    </div>`;
  }
}

customElements.define(
  "autoschedule-workbook-import-dialog",
  WorkbookImportDialogElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-workbook-import-dialog": WorkbookImportDialogElement;
  }
}
