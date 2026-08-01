import { html } from "lit";

import type { DutyRosterImportPreview } from "../../infrastructure/duty-roster-excel";
import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class DutyRosterImportDialogElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    preview: { attribute: false },
  };
  model!: AppState;
  preview!: DutyRosterImportPreview;

  protected override render() {
    return html`<div class="modal-body duty-roster-import-preview">
        <div class="duty-import-summary">
          <span>目标月份 <strong>${this.preview.month}</strong></span
          ><span
            >识别安排
            <strong>${this.preview.recognizedAssignments}</strong> 项</span
          ><span>值班/备勤将整月替换，CX航前保持不变</span>
        </div>
        ${this.preview.errors.map((message) => html`<div class="alert alert-danger py-2 mb-2"><i class="bi bi-x-circle me-2"></i>${message}</div>`)}
        ${this.preview.warnings.map((message) => html`<div class="alert alert-warning py-2 mb-2"><i class="bi bi-exclamation-triangle me-2"></i>${message}</div>`)}
        <div class="table-responsive">
          <table class="table table-sm align-middle data-table">
            <thead>
              <tr>
                <th>工作班日期</th>
                <th>值班人员</th>
                <th>次日备勤日期</th>
                <th>次日备勤一</th>
                <th>次日备勤二</th>
              </tr>
            </thead>
            <tbody>
              ${this.preview.rows.map(
                (row) =>
                  html`<tr>
                    <td><strong>${row.date}</strong></td>
                    <td>
                      ${row.dutyIncluded === false ? html`<span class="text-secondary">本表未覆盖，保持原值</span>` : this.name(row.dutyStaffId)}
                    </td>
                    <td>${row.standbyDate}</td>
                    ${
                      row.standbyIncluded === false
                        ? html`<td colspan="2">
                            <span class="text-secondary"
                              >本表未覆盖，保持原值</span
                            >
                          </td>`
                        : html`<td>${this.name(row.standbyStaffIds[0])}</td>
                            <td>${this.name(row.standbyStaffIds[1])}</td>`
                    }
                  </tr>`
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-bs-dismiss="modal">
          取消
        </button>
        <button
          class="btn btn-primary"
          type="button"
          ?disabled=${!this.preview.canApply}
          @click=${() => dispatchUiCommand(this, { type: "apply-duty-roster-import" })}
        >
          确认应用预览中的值班备勤
        </button>
      </div>`;
  }

  private name(id: string | null): string {
    return id
      ? (this.model.staff.find((person) => person.id === id)?.name ?? `#${id}`)
      : "未配置";
  }
}

customElements.define(
  "autoschedule-duty-roster-import-dialog",
  DutyRosterImportDialogElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-duty-roster-import-dialog": DutyRosterImportDialogElement;
  }
}
