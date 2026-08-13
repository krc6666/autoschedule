import { html } from "lit";

import type { ScheduleProgressView } from "../../app/application-view-state";
import { projectScheduleProgressTasks } from "../projections/schedule-progress-tasks";
import { LightDomElement } from "./light-dom-element";
import { dispatchUiCommand } from "../events/ui-command";

export class ScheduleProgressPanelElement extends LightDomElement {
  static override properties = { progress: { attribute: false } };
  progress!: ScheduleProgressView;

  protected override render() {
    const tasks = projectScheduleProgressTasks(
      this.progress.steps,
      this.progress.stage,
      this.progress.outcome
    );
    return html`<section
      class="schedule-progress-panel"
      role="status"
      aria-live="polite"
      aria-label="排班进度"
      ?hidden=${!this.progress.visible}
    >
      <header class="schedule-progress-heading">
        <strong>排班进度</strong>
        <span>${this.progress.percent}%</span>
      </header>
      <div
        class="progress"
        role="progressbar"
        aria-label="排班完成比例"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${this.progress.percent}
      >
        <div
          class="progress-bar"
          style=${`width: ${this.progress.percent}%`}
        ></div>
      </div>
      <ol class="schedule-progress-tasks">
        ${tasks.map(
          (task) =>
            html`<li class="schedule-progress-task is-${task.status}">
              <span class="schedule-progress-marker" aria-hidden="true">
                <i class="bi bi-${this.icon(task.status)}"></i>
              </span>
              <span>${task.label}</span>
            </li>`
        )}
      </ol>
      ${
        this.progress.outcome === "running"
          ? html`<div class="schedule-progress-actions">
              <button
                class="btn btn-sm btn-outline-secondary"
                type="button"
                aria-label="停止排班，不采用结果"
                @click=${() =>
                dispatchUiCommand(this, {
                  type: "stop-schedule-without-result",
                })}
              >
                <i class="bi bi-stop-circle" aria-hidden="true"></i
                ><span>停止，不采用</span>
              </button>
              <button
                class="btn btn-sm btn-primary"
                type="button"
                aria-label="停止排班并采用当前方案"
                title=${
                this.progress.canAdoptCurrentResult
                  ? "停止继续计算并采用最近一份完整安全方案"
                  : "完整安全方案准备好后才可采用"
              }
                ?disabled=${!this.progress.canAdoptCurrentResult}
                @click=${() =>
                dispatchUiCommand(this, {
                  type: "stop-schedule-with-current-result",
                })}
              >
                <i class="bi bi-check2-circle" aria-hidden="true"></i
                ><span>停止并采用</span>
              </button>
            </div>`
          : null
      }
    </section>`;
  }

  private icon(status: string): string {
    if (status === "completed") return "check-lg";
    if (status === "active") return "circle-fill";
    if (status === "failed") return "exclamation-lg";
    return "circle";
  }
}

customElements.define(
  "autoschedule-progress-panel",
  ScheduleProgressPanelElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-progress-panel": ScheduleProgressPanelElement;
  }
}
