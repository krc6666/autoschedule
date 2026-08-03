import { html } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import { assignmentRule } from "../../domain/flights/schedule-position-rules";
import type { AppState, Assignment } from "../../model";
import { visiblePositionRemark } from "../../utils";
import type {
  ScheduleFlightGroup,
  SchedulePageModel,
} from "../projections/schedule-page-model";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

interface DragPayload {
  staffId?: string;
  assignmentId?: string;
}

export class ScheduleGridElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    view: { attribute: false },
  };
  model!: AppState;
  view!: SchedulePageModel;
  private readonly temporaryDrafts = new Map<
    string,
    { position: string; staffName: string }
  >();

  protected override render() {
    const groups = this.view.groups;
    return html`<div class="table-responsive schedule-board">
      <table
        class="table table-sm table-bordered align-middle mb-0 schedule-grid-table"
        style=${styleMap(this.view.tableStyles)}
      >
        <colgroup>
          ${groups.flatMap(() => [html`<col class="schedule-position-column" />`, html`<col class="schedule-person-column" />`])}
        </colgroup>
        <thead>
          <tr>
            ${groups.map(
              ({ flight }) =>
                html`<th scope="col" colspan="2">
                  <div class="schedule-flight-head">
                    <div>
                      <strong>${flight.flightNo}</strong
                      ><span>${flight.startTime}–${flight.endTime}</span
                      >${flight.remark ? html`<small>${flight.remark}</small>` : null}
                    </div>
                  </div>
                </th>`
            )}
          </tr>
          <tr class="schedule-subhead-row">
            ${groups.flatMap(() => [html`<th scope="col" class="schedule-subhead-position">岗位</th>`, html`<th scope="col" class="schedule-subhead-person">人员</th>`])}
          </tr>
        </thead>
        <tbody>
          ${Array.from(
            { length: this.view.primaryRowCount },
            (_, rowIndex) =>
              html`<tr>
                ${groups.map((group) => this.cells(group, group.primary[rowIndex], "primary", rowIndex))}
              </tr>`
          )}
          <tr class="schedule-divider-row">
            ${groups.map(
              () =>
                html`<td colspan="2">
                  <div class="support-divider"><span>引导岗位</span></div>
                </td>`
            )}
          </tr>
          ${Array.from(
            { length: this.view.bottomRowCount },
            (_, rowIndex) =>
              html`<tr>
                ${groups.map((group) => this.cells(group, group.bottom[rowIndex], "bottom", rowIndex))}
              </tr>`
          )}
        </tbody>
      </table>
      <datalist id="schedule-staff-names">
        ${this.model.staff.filter((person) => person.status === "正常" && (this.model.settings.adminSupportEnabled || person.staffType !== "行政支援")).map((person) => html`<option .value=${person.name}></option>`)}
      </datalist>
      ${groups.map((group) => html`<datalist id=${group.guideListId}>${group.guideCandidates.map((person) => html`<option .value=${person.name}></option>`)}</datalist>`)}
    </div>`;
  }

  private cells(
    group: ScheduleFlightGroup,
    assignment: Assignment | undefined,
    layoutGroup: "primary" | "bottom",
    layoutIndex: number
  ) {
    return assignment
      ? this.assignmentCells(assignment, group.guideListId)
      : this.emptyCells(group.flight.id, layoutGroup, layoutIndex);
  }

  private assignmentCells(assignment: Assignment, guideListId: string) {
    const rule = assignmentRule(this.model, assignment);
    const temporary = !rule && Boolean(assignment.layoutGroup);
    const guide = rule?.category === "引导";
    const administrative = rule?.category === "行政支援";
    const diversion = rule?.category === "分流";
    const auxiliary = administrative || !rule;
    const warning = assignment.decisionTrace?.find(
      (decision) =>
        decision.outcome === "fallback" &&
        decision.ruleId !== "cross-workday-load"
    );
    const stateClasses = [
      assignment.staffName ? "is-assigned" : "is-unfilled",
      guide ? "is-guide" : "",
      administrative ? "is-admin-support" : "",
      diversion ? "is-diversion" : "",
      warning ? "is-soft-rule-warning" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const remark = visiblePositionRemark(assignment.remark);
    return [
      html`<td class="schedule-grid-slot schedule-position-slot">
        <article class="schedule-cell schedule-position-cell ${stateClasses}">
          <div class="schedule-position-content">
            ${
              temporary
                ? html`<input
                    class="schedule-position-input"
                    .value=${assignment.position}
                    aria-label="临时岗位名称"
                    @change=${(event: Event) => this.updateAssignment(assignment.id, "position", event)}
                  />`
                : html`<strong
                    class="schedule-position"
                    title=${assignment.position}
                    >${guide ? html`<span class="guide-tag">引</span>` : administrative ? html`<span class="admin-support-tag">行</span>` : diversion ? html`<span class="diversion-tag">流</span>` : null}${assignment.position}</strong
                  >`
            }
            ${remark ? html`<span class="position-remark" title=${remark}>${remark}</span>` : null}
          </div>
          ${
            temporary
              ? html`<div class="schedule-cell-actions">
                  <button
                    class="btn btn-sm btn-light icon-btn"
                    type="button"
                    title="删除本次临时岗位"
                    aria-label="删除本次临时岗位"
                    @click=${() => dispatchUiCommand(this, { type: "delete-temporary-assignment", id: assignment.id })}
                  >
                    <i class="bi bi-x-lg"></i>
                  </button>
                </div>`
              : null
          }
        </article>
      </td>`,
      html`<td class="schedule-grid-slot schedule-person-slot">
        <article
          class="schedule-cell schedule-person-cell ${stateClasses}"
          @dragover=${(event: DragEvent) => event.preventDefault()}
          @drop=${(event: DragEvent) => this.drop(event, assignment.id)}
          @pointerenter=${() => this.pointerTarget(assignment.id)}
        >
          <div
            class="schedule-person-edit"
            draggable=${String(Boolean(assignment.staffId))}
            title=${assignment.staffId ? "按住姓名可拖动调整岗位" : ""}
            @dragstart=${(event: DragEvent) => this.dragAssignment(event, assignment)}
            @pointerdown=${() => this.pointerSource(assignment)}
          >
            ${assignment.staffId ? html`<i class="bi bi-grip-vertical assignment-drag-handle" aria-hidden="true"></i>` : null}
            ${warning ? html`<i class="bi bi-exclamation-triangle-fill schedule-soft-warning-icon" title=${warning.message} aria-label=${warning.ruleId === "position-rotation" ? "连续轮岗异常" : "软约束提醒"}></i>` : null}
            <input
              class="schedule-name-input"
              list=${guide ? guideListId : auxiliary ? "" : "schedule-staff-names"}
              .value=${assignment.staffName}
              aria-label="${assignment.position}人员"
              @change=${(event: Event) => this.updateAssignment(assignment.id, "staffName", event)}
            />
          </div>
          <div class="schedule-cell-actions">
            <button
              class="btn btn-sm btn-light icon-btn"
              type="button"
              title="清空人员"
              aria-label="清空人员"
              @click=${() => dispatchUiCommand(this, { type: "assign-staff", assignmentId: assignment.id, staffId: "" })}
            >
              <i class="bi bi-eraser"></i>
            </button>
          </div>
          <input
            class="schedule-manual-remark"
            .value=${assignment.manualRemark}
            placeholder=" "
            title="输入临时备注"
            aria-label="${assignment.position}临时备注"
            @change=${(event: Event) => this.updateAssignment(assignment.id, "manualRemark", event)}
          />
        </article>
      </td>`,
    ];
  }

  private emptyCells(
    flightId: string,
    layoutGroup: "primary" | "bottom",
    layoutIndex: number
  ) {
    const key = `${flightId}:${layoutGroup}:${layoutIndex}`;
    return [
      html`<td class="schedule-grid-slot schedule-position-slot">
        <div
          class="schedule-cell schedule-cell-placeholder schedule-position-cell"
        >
          <input
            class="schedule-empty-input schedule-empty-position"
            placeholder="岗位"
            aria-label="新增临时岗位"
            @input=${(event: Event) => this.updateDraft(key, "position", event)}
            @change=${() => this.createTemporary(key, flightId, layoutGroup, layoutIndex)}
          />
        </div>
      </td>`,
      html`<td class="schedule-grid-slot schedule-person-slot">
        <div
          class="schedule-cell schedule-cell-placeholder schedule-person-cell"
        >
          <input
            class="schedule-empty-input schedule-empty-name"
            placeholder="人员"
            aria-label="新增临时人员"
            @input=${(event: Event) => this.updateDraft(key, "staffName", event)}
            @change=${() => this.createTemporary(key, flightId, layoutGroup, layoutIndex)}
          />
        </div>
      </td>`,
    ];
  }

  private updateAssignment(id: string, field: string, event: Event): void {
    dispatchUiCommand(this, {
      type: "update-assignment",
      id,
      field,
      value: (event.currentTarget as HTMLInputElement).value,
    });
  }

  private updateDraft(
    key: string,
    field: "position" | "staffName",
    event: Event
  ): void {
    const draft = this.temporaryDrafts.get(key) ?? {
      position: "",
      staffName: "",
    };
    draft[field] = (event.currentTarget as HTMLInputElement).value;
    this.temporaryDrafts.set(key, draft);
  }

  private createTemporary(
    key: string,
    flightId: string,
    layoutGroup: "primary" | "bottom",
    layoutIndex: number
  ): void {
    const draft = this.temporaryDrafts.get(key) ?? {
      position: "",
      staffName: "",
    };
    if (!draft.position.trim() && !draft.staffName.trim()) return;
    dispatchUiCommand(this, {
      type: "create-temporary-assignment",
      flightId,
      position: draft.position.trim() || "临时岗位",
      staffName: draft.staffName.trim(),
      layoutGroup,
      layoutIndex,
    });
    this.temporaryDrafts.delete(key);
  }

  private dragAssignment(event: DragEvent, assignment: Assignment): void {
    if (!event.dataTransfer || !assignment.staffId) return;
    event.dataTransfer.setData(
      "application/x-autoschedule",
      JSON.stringify({
        assignmentId: assignment.id,
        staffId: assignment.staffId,
      })
    );
  }

  private drop(event: DragEvent, assignmentId: string): void {
    event.preventDefault();
    try {
      const payload = JSON.parse(
        event.dataTransfer?.getData("application/x-autoschedule") ?? "{}"
      ) as DragPayload;
      if (payload.staffId)
        dispatchUiCommand(this, {
          type: "assign-staff",
          assignmentId,
          staffId: payload.staffId,
          sourceAssignmentId: payload.assignmentId,
        });
    } catch {
      return;
    }
  }

  private pointerSource(assignment: Assignment): void {
    if (!assignment.staffId) return;
    this.dispatchEvent(
      new CustomEvent("autoschedule-pointer-drag-start", {
        detail: { assignmentId: assignment.id, staffId: assignment.staffId },
        bubbles: true,
        composed: true,
      })
    );
  }

  private pointerTarget(assignmentId: string): void {
    this.dispatchEvent(
      new CustomEvent("autoschedule-pointer-drag-target", {
        detail: { assignmentId },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("autoschedule-schedule-grid", ScheduleGridElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-schedule-grid": ScheduleGridElement;
  }
}
