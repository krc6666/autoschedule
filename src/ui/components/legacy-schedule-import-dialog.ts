import { html } from "lit";

import type { LegacyScheduleImportPreview } from "../../infrastructure/legacy-schedule-excel";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class LegacyScheduleImportDialogElement extends LightDomElement {
  static override properties = {
    date: { type: String },
    preview: { attribute: false },
  };
  date = "";
  preview!: LegacyScheduleImportPreview;

  protected override render() {
    const visible = this.preview.records.slice(0, 200);
    return html`<div class="modal-body">
        <div class="alert alert-warning py-2">
          <i class="bi bi-info-circle me-2"></i>
          这是旧版横向手工排班表。请选择这份文件对应的工作日期；Excel
          内部日期不会参与导入。
        </div>
        <div class="d-flex align-items-center gap-2 mb-3">
          <label class="form-label mb-0" for="legacy-import-date"
            >导入日期</label
          >
          <input
            id="legacy-import-date"
            class="form-control form-control-sm"
            type="date"
            .value=${this.date}
            @change=${(event: Event) =>
            dispatchUiCommand(this, {
              type: "update-legacy-schedule-import-date",
              date: (event.currentTarget as HTMLInputElement).value,
            })}
          />
          <span class="small text-secondary">所有导入记录统一使用此日期</span>
        </div>
        <div class="row g-2 mb-3">
          ${this.summary("工作表", `${this.preview.recognizedSheets} 个`)}
          ${this.summary("末班重点可导入", `${this.preview.readyRecords} 条`)}
          ${this.summary("下午/非末班不计入", `${this.preview.ignoredRecords} 条`)}
        </div>
        <div class="table-responsive border rounded">
          <table class="table table-sm mb-0 align-middle">
            <thead>
              <tr>
                <th>日期</th>
                <th>航班</th>
                <th>岗位</th>
                <th>人员</th>
                <th>原始内容</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              ${visible.map(
              (record) =>
                html`<tr>
                  <td>${record.date}</td>
                  <td>${record.flightNo}</td>
                  <td>${record.position}</td>
                  <td>${record.staffName || "未识别"}</td>
                  <td class="text-break">${record.rawText}</td>
                  <td>
                    <span
                      class="badge ${record.status === "ready" ? "text-bg-success" : "text-bg-warning"}"
                    >
                      ${record.status === "ready" ? "可导入" : record.issue || "待确认"}
                    </span>
                  </td>
                </tr>`
            )}
            </tbody>
          </table>
        </div>
        ${
        this.preview.records.length > visible.length
          ? html`<div class="small text-secondary mt-2">
              预览前 ${visible.length} 条，剩余记录按相同规则处理。
            </div>`
          : null
      }
        ${this.preview.warnings
        .slice(0, 20)
        .map(
          (message) =>
            html`<div class="small text-warning mt-1">${message}</div>`
        )}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" type="button" data-bs-dismiss="modal">
          取消
        </button>
        <button
          class="btn btn-primary"
          type="button"
          ?disabled=${!this.preview.readyRecords}
          @click=${() => dispatchUiCommand(this, { type: "apply-legacy-schedule-import" })}
        >
          <i class="bi bi-check2 me-1"></i>导入末班重点历史记录
        </button>
      </div>`;
  }

  private summary(label: string, value: string) {
    return html`<div class="col-md-4">
      <div class="small text-secondary">${label}</div>
      <div class="fw-semibold">${value}</div>
    </div>`;
  }
}

customElements.define(
  "autoschedule-legacy-schedule-import-dialog",
  LegacyScheduleImportDialogElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-legacy-schedule-import-dialog": LegacyScheduleImportDialogElement;
  }
}
