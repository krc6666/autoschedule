import { html, nothing } from "lit";

import type { ApplicationDialog } from "../../app/application-view-state";
import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

type SwapAnalysisDialog = Extract<ApplicationDialog, { kind: "swap-analysis" }>;

export class SwapAnalysisDialogElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    dialog: { attribute: false },
  };

  model!: AppState;
  dialog!: SwapAnalysisDialog;

  protected override render() {
    const source = this.model.assignments.find(
      (assignment) => assignment.id === this.dialog.sourceAssignmentId
    );
    if (!source) return html`<div class="modal-body">目标岗位已不存在。</div>`;
    const candidates = this.model.assignments.filter(
      (assignment) =>
        assignment.id !== source.id &&
        assignment.status === "assigned" &&
        assignment.staffId &&
        assignment.staffId !== source.staffId
    );
    const analysis = this.dialog.analysis;
    const outcomeLabel =
      analysis?.outcome === "safe"
        ? "可以安全调整"
        : analysis?.outcome === "soft-tradeoff"
          ? "可以调整，但有取舍"
          : analysis?.outcome === "blocked"
            ? "不能调整"
            : "请选择一名人员进行比较";
    const tone =
      analysis?.outcome === "safe"
        ? "success"
        : analysis?.outcome === "blocked"
          ? "danger"
          : "warning";
    return html`
      <div class="modal-body swap-analysis-body">
        <div class="swap-analysis-source">
          <span class="text-secondary">当前提醒岗位</span>
          <strong
            >${source.flightNo} / ${source.position} ·
            ${source.staffName}</strong
          >
        </div>
        <label class="form-label" for="swap-analysis-target"
          >选择交换人员</label
        >
        <select
          id="swap-analysis-target"
          class="form-select"
          aria-label="选择交换人员"
          .value=${this.dialog.targetAssignmentId ?? ""}
          @change=${(event: Event) =>
            dispatchUiCommand(this, {
              type: "select-swap-target",
              assignmentId: (event.currentTarget as HTMLSelectElement).value,
            })}
        >
          <option value="">请选择</option>
          ${candidates.map(
            (assignment) =>
              html`<option value=${assignment.id}>
                ${assignment.staffName} ·
                ${assignment.flightNo}/${assignment.position}
              </option>`
          )}
        </select>
        <div class="alert alert-${tone} mt-3 mb-0" role="status">
          <strong>${outcomeLabel}</strong>
        </div>
        ${analysis ? this.analysisDetails(analysis) : nothing}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-light" data-bs-dismiss="modal">
          取消
        </button>
        <button
          type="button"
          class="btn btn-primary"
          aria-label="确认交换岗位"
          ?disabled=${!analysis || analysis.outcome === "blocked"}
          @click=${() => dispatchUiCommand(this, { type: "apply-swap-analysis" })}
        >
          确认交换
        </button>
      </div>
    `;
  }

  private analysisDetails(
    analysis: NonNullable<SwapAnalysisDialog["analysis"]>
  ) {
    return html`<div class="swap-analysis-details">
      ${this.reasonList("调整后的改善", analysis.improvements, "check-circle")}
      ${this.reasonList("需要接受的取舍", analysis.tradeoffs, "exclamation-circle")}
      ${this.reasonList("不能调整的原因", analysis.blockers, "x-circle")}
    </div>`;
  }

  private reasonList(title: string, reasons: string[], icon: string) {
    if (!reasons.length) return nothing;
    return html`<section>
      <h3>${title}</h3>
      <ul>
        ${reasons.map(
          (reason) =>
            html`<li>
              <i class="bi bi-${icon}" aria-hidden="true"></i
              ><span>${reason}</span>
            </li>`
        )}
      </ul>
    </section>`;
  }
}

customElements.define(
  "autoschedule-swap-analysis-dialog",
  SwapAnalysisDialogElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-swap-analysis-dialog": SwapAnalysisDialogElement;
  }
}
