import { html } from "lit";

import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class ScheduleToolbarElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    date: { type: String },
    zoom: { type: Number },
  };
  model!: AppState;
  date = "";
  zoom = 1;

  protected override render() {
    return html`<section class="toolbar-band schedule-toolbar">
      <div class="d-flex gap-1 flex-wrap">
        ${this.command("arrow-repeat", "重新排班", "generate-schedule", "btn-primary")}
        ${this.command("calendar2-plus", "归档并排后天", "archive-next-duty-day", "btn-success")}
        ${this.command("file-earmark-excel", "导出结果", "export-schedule", "btn-outline-success")}
        ${this.iconCommand("filetype-html", "导出 HTML", "export-share-html")}
        ${this.iconCommand("file-earmark-image", "导出图片", "export-share-png")}
        ${this.command("archive", "仅归档", "archive-schedule", "btn-outline-secondary")}
        ${this.iconCommand("x-circle", "清空排班", "clear-schedule", "btn-outline-danger")}
      </div>
      <div class="schedule-toolbar-meta">
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
            @change=${(event: Event) => dispatchUiCommand(this, { type: "toggle-administrative-mode", enabled: (event.currentTarget as HTMLInputElement).checked })}
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
}

customElements.define("autoschedule-schedule-toolbar", ScheduleToolbarElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-schedule-toolbar": ScheduleToolbarElement;
  }
}
