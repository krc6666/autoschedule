import { html } from "lit";

import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";
import "./half-rest-selector";

export class ScheduleToolbarElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    date: { type: String },
    zoom: { type: Number },
    previousScheduleDate: { type: String },
    previousScheduleVisible: { type: Boolean },
    halfRestStaffIds: { attribute: false },
  };
  model!: AppState;
  date = "";
  zoom = 1;
  previousScheduleDate = "";
  previousScheduleVisible = false;
  halfRestStaffIds: string[] = [];

  protected override render() {
    return html`<section class="toolbar-band schedule-toolbar">
      <div class="d-flex gap-1 flex-wrap">
        ${this.command("arrow-repeat", "重新排班", "open-reschedule-flight-picker", "btn-primary")}
        ${this.command("calendar2-plus", "归档并排后天", "archive-next-duty-day", "btn-success")}
        ${this.command("file-earmark-excel", "导出结果", "export-schedule", "btn-outline-success")}
        ${this.iconCommand("filetype-html", "导出 HTML", "export-share-html")}
        ${this.iconCommand("file-earmark-image", "导出图片", "export-share-png")}
        ${this.command("archive", "仅归档", "archive-schedule", "btn-outline-secondary")}
        ${this.previousScheduleCommand()}
        ${this.iconCommand("x-circle", "清空排班", "clear-schedule", "btn-outline-danger")}
      </div>
      <div class="schedule-toolbar-meta">
        <autoschedule-half-rest-selector
          .model=${this.model}
          .selectedStaffIds=${this.halfRestStaffIds}
        ></autoschedule-half-rest-selector>
        <div class="schedule-zoom-control" role="group" aria-label="排班表缩放">
          ${this.zoomButton("zoom-out", "缩小排班表", this.zoom - 0.1, this.zoom <= 0.7)}
          <output aria-label="当前排班表比例"
            >${Math.round(this.zoom * 100)}%</output
          >
          ${this.zoomButton("arrow-counterclockwise", "恢复 100%", 1, false)}
          ${this.zoomButton("zoom-in", "放大排班表", this.zoom + 0.1, this.zoom >= 1.6)}
        </div>
        <label
          class="form-check form-switch admin-support-switch"
          title="切换后会按当前模式重新排班"
        >
          <input
            class="form-check-input"
            type="checkbox"
            .checked=${this.model.settings.adminSupportEnabled}
            @change=${this.toggleAdministrativeMode}
          />
          <span class="form-check-label">是否启用行政支援模式</span>
        </label>
        <span class="small text-secondary">${this.date}</span>
      </div>
    </section>`;
  }

  private command(
    icon: string,
    label: string,
    type:
      | "generate-schedule"
      | "open-reschedule-flight-picker"
      | "archive-next-duty-day"
      | "export-schedule"
      | "archive-schedule",
    style: string
  ) {
    return html`<button
      class="btn btn-sm ${style}"
      type="button"
      @click=${() => dispatchUiCommand(this, { type })}
    >
      <i class="bi bi-${icon} me-1"></i>${label}
    </button>`;
  }

  private iconCommand(
    icon: string,
    label: string,
    type: "export-share-html" | "export-share-png" | "clear-schedule",
    style = "btn-outline-primary"
  ) {
    return html`<button
      class="btn btn-sm ${style} icon-btn"
      type="button"
      title=${label}
      aria-label=${label}
      @click=${() => dispatchUiCommand(this, { type })}
    >
      <i class="bi bi-${icon}"></i>
    </button>`;
  }

  private previousScheduleCommand() {
    const available = Boolean(this.previousScheduleDate);
    const label = !available
      ? "暂无上一班记录"
      : this.previousScheduleVisible
        ? "收起上一班"
        : "对比上一班";
    return html`<button
      class="btn btn-sm btn-outline-secondary"
      type="button"
      title=${available ? `${this.previousScheduleDate} 已归档班表` : "当前日期之前没有已归档班表"}
      ?disabled=${!available}
      @click=${this.togglePreviousSchedule}
    >
      <i class="bi bi-layout-split me-1"></i>${label}
    </button>`;
  }

  private zoomButton(
    icon: string,
    label: string,
    value: number,
    disabled: boolean
  ) {
    return html`<button
      class="btn btn-sm icon-btn"
      type="button"
      title=${label}
      aria-label=${label}
      ?disabled=${disabled}
      @click=${() => dispatchUiCommand(this, { type: "set-schedule-zoom", value })}
    >
      <i class="bi bi-${icon}"></i>
    </button>`;
  }

  private toggleAdministrativeMode(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const enabled = input.checked;
    input.checked = this.model.settings.adminSupportEnabled;
    dispatchUiCommand(this, {
      type: "toggle-administrative-mode",
      enabled,
    });
  }

  private togglePreviousSchedule(): void {
    this.dispatchEvent(
      new Event("autoschedule-toggle-previous-schedule", {
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("autoschedule-schedule-toolbar", ScheduleToolbarElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-schedule-toolbar": ScheduleToolbarElement;
  }
}
