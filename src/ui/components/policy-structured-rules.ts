import { html, nothing } from "lit";

import type { AppState } from "../../model";
import { dispatchUiCommand, inputValue } from "../events/ui-command";
import {
  matchesPolicySearch,
  normalizePolicySearchQuery,
} from "../projections/policy-search";
import { LightDomElement } from "./light-dom-element";

type Collection =
  | "duty"
  | "recovery-target"
  | "cross-workday-reservation"
  | "late-position"
  | "supervisor"
  | "transition";

export class PolicyStructuredRulesElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    query: { type: String },
  };
  model!: AppState;
  query = "";

  protected override render() {
    return html`
      ${this.dutyPriorities()} ${this.crossWorkdayReservations()}
      ${this.recoveryRules()} ${this.supervisorRules()}
      ${this.transitionRules()}
    `;
  }

  private crossWorkdayReservations() {
    const items = this.model.settings.crossWorkdayQualificationReservations;
    if (
      !matchesPolicySearch(
        this.query,
        "跨工作日资质预留",
        "从上到下依次保留",
        "新增预留目标",
        "启用",
        "下一工作班航班",
        "匹配位置",
        "岗位名称",
        "岗位备注",
        "岗位关键词",
        "至少保留人数",
        items.map((item) => [
          item.flightNo,
          item.keyword,
          item.minimumStaffCount,
        ])
      )
    ) {
      return nothing;
    }
    return html`<details
      class="policy-rule-card"
      ?open=${Boolean(normalizePolicySearchQuery(this.query))}
    >
      <summary>
        <span
          ><strong>跨工作日资质预留</strong
          ><small
            >${items.filter((item) => item.enabled).length} 条启用 ·
            从上到下依次保留</small
          ></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      <div class="policy-rule-content">
        <div class="d-flex justify-content-end mb-2">
          ${this.addButton("cross-workday-reservation", "新增预留目标")}
        </div>
        <div class="supervisor-coverage-list">
          ${items.map(
            (item, index) =>
              html`<div class="supervisor-coverage-row">
                ${this.toggle("cross-workday-reservation", item.id, "enabled", item.enabled, "启用")}
                ${this.field("cross-workday-reservation", item.id, "flightNo", item.flightNo, "下一工作班航班")}
                ${this.select(
                "cross-workday-reservation",
                item.id,
                "matchField",
                item.matchField,
                "匹配位置",
                [
                  ["position", "岗位名称"],
                  ["remark", "岗位备注"],
                ]
              )}
                ${this.field("cross-workday-reservation", item.id, "keyword", item.keyword, "岗位关键词")}
                ${this.field("cross-workday-reservation", item.id, "minimumStaffCount", item.minimumStaffCount, "至少保留人数", "", "number")}
                <div class="d-flex gap-1">
                  ${this.moveReservation(item.id, -1, index === 0)}
                  ${this.moveReservation(item.id, 1, index === items.length - 1)}
                  ${this.deleteButton("cross-workday-reservation", item.id)}
                </div>
              </div>`
          )}
        </div>
      </div>
    </details>`;
  }

  private dutyPriorities() {
    const items = this.model.settings.dutyPositionPriorities;
    if (
      !matchesPolicySearch(
        this.query,
        "值班任务规则",
        "按顺序逐项尝试",
        "新增优先项",
        "航班号",
        "岗位或备注关键词",
        "启用",
        items.map((item) => [item.flightNo, item.positionKeyword])
      )
    ) {
      return nothing;
    }
    return html`<details
      class="policy-rule-card"
      ?open=${Boolean(normalizePolicySearchQuery(this.query))}
    >
      <summary>
        <span
          ><strong>值班任务规则</strong
          ><small
            >${items.filter((item) => item.enabled).length} 个优先项 ·
            按顺序逐项尝试</small
          ></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      <div class="policy-rule-content">
        <div class="d-flex justify-content-end mb-2">
          ${this.addButton("duty", "新增优先项")}
        </div>
        <div class="duty-priority-list">
          ${items.map(
            (item, index) =>
              html`<div class="duty-priority-row">
                <span class="duty-priority-order">${index + 1}</span>
                ${this.field("duty-priority", item.id, "flightNo", item.flightNo, "航班号")}
                ${this.field("duty-priority", item.id, "positionKeyword", item.positionKeyword, "岗位或备注关键词")}
                ${this.toggle("duty-priority", item.id, "enabled", item.enabled, "启用")}
                <div class="duty-priority-actions">
                  ${this.moveDuty(item.id, -1, index === 0)}${this.moveDuty(item.id, 1, index === items.length - 1)}${this.deleteButton("duty", item.id)}
                </div>
              </div>`
          )}
        </div>
      </div>
    </details>`;
  }

  private recoveryRules() {
    const settings = this.model.settings;
    if (
      !matchesPolicySearch(
        this.query,
        "跨工作日恢复目标",
        "末班重点岗位",
        "新增规则",
        "适用航班",
        "匹配位置",
        "岗位名称",
        "岗位备注",
        "关键词",
        "次班截止时间",
        "次班早班避让目标",
        "新增目标",
        "目标航班",
        "岗位或备注关键词",
        settings.lateShiftRecoveryPositionRules.map((rule) => [
          rule.flightNo,
          rule.keyword,
          rule.nextWorkdayCutoffTime,
        ]),
        settings.nextWorkdayRecoveryTargets.map((target) => [
          target.flightNo,
          target.positionKeyword,
        ])
      )
    ) {
      return nothing;
    }
    return html`<details
      class="policy-rule-card"
      ?open=${Boolean(normalizePolicySearchQuery(this.query))}
    >
      <summary>
        <span
          ><strong>跨工作日恢复目标</strong
          ><small
            >${settings.lateShiftRecoveryPositionRules.filter((item) => item.enabled).length}
            条末班规则 ·
            ${settings.nextWorkdayRecoveryTargets.filter((item) => item.enabled).length}
            个次班目标</small
          ></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      <div class="policy-rule-content">
        <div class="d-flex justify-content-between align-items-center">
          <strong>末班重点岗位</strong
          >${this.addButton("late-position", "新增规则")}
        </div>
        <div class="supervisor-coverage-list mt-2">
          ${settings.lateShiftRecoveryPositionRules.map(
            (rule) =>
              html`<div class="supervisor-coverage-row">
                ${this.toggle("late-shift-recovery-position", rule.id, "enabled", rule.enabled, "启用")}
                ${this.field("late-shift-recovery-position", rule.id, "flightNo", rule.flightNo, "适用航班", "留空=全部")}
                ${this.select(
                  "late-shift-recovery-position",
                  rule.id,
                  "matchField",
                  rule.matchField,
                  "匹配位置",
                  [
                    ["position", "岗位名称"],
                    ["remark", "岗位备注"],
                  ]
                )}
                ${this.field("late-shift-recovery-position", rule.id, "keyword", rule.keyword, "关键词")}
                ${this.field("late-shift-recovery-position", rule.id, "nextWorkdayCutoffTime", rule.nextWorkdayCutoffTime, "次班截止时间", "", "time")}
                ${this.deleteButton("late-position", rule.id)}
              </div>`
          )}
        </div>
        <div class="d-flex justify-content-between align-items-center mt-3">
          <strong>次班早班避让目标</strong
          >${this.addButton("recovery-target", "新增目标")}
        </div>
        <div class="duty-priority-list mt-2">
          ${settings.nextWorkdayRecoveryTargets.map(
            (target) =>
              html`<div class="duty-priority-row">
                ${this.toggle("recovery-target", target.id, "enabled", target.enabled, "启用")}
                ${this.field("recovery-target", target.id, "flightNo", target.flightNo, "目标航班")}
                ${this.field("recovery-target", target.id, "positionKeyword", target.positionKeyword, "岗位或备注关键词")}
                ${this.deleteButton("recovery-target", target.id)}
              </div>`
          )}
        </div>
      </div>
    </details>`;
  }

  private supervisorRules() {
    const items = this.model.settings.mobileSupervisorCoverageRules;
    if (
      !matchesPolicySearch(
        this.query,
        "机动督导兼任范围",
        "自动排班与人工拖拽共用",
        "禁止优先",
        "新增规则",
        "适用航班",
        "匹配位置",
        "岗位名称",
        "岗位备注",
        "关键词",
        "处理方式",
        "禁止兼任",
        "允许兼任",
        items.map((item) => [item.flightNo, item.keyword])
      )
    ) {
      return nothing;
    }
    return html`<details
      class="policy-rule-card"
      ?open=${Boolean(normalizePolicySearchQuery(this.query))}
    >
      <summary>
        <span
          ><strong>机动督导兼任范围</strong
          ><small>自动排班与人工拖拽共用 · 禁止优先</small></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      <div class="policy-rule-content">
        <div class="d-flex justify-content-end mb-2">
          ${this.addButton("supervisor", "新增规则")}
        </div>
        <div class="supervisor-coverage-list">
          ${items.map(
            (rule) =>
              html`<div class="supervisor-coverage-row">
                ${this.toggle("supervisor-coverage", rule.id, "enabled", rule.enabled, "启用")}
                ${this.field("supervisor-coverage", rule.id, "flightNo", rule.flightNo, "适用航班", "留空=全部")}
                ${this.select(
                  "supervisor-coverage",
                  rule.id,
                  "matchField",
                  rule.matchField,
                  "匹配位置",
                  [
                    ["position", "岗位名称"],
                    ["remark", "岗位备注"],
                  ]
                )}
                ${this.field("supervisor-coverage", rule.id, "keyword", rule.keyword, "关键词")}
                ${this.select(
                  "supervisor-coverage",
                  rule.id,
                  "mode",
                  rule.mode,
                  "处理方式",
                  [
                    ["forbid", "禁止兼任"],
                    ["allow", "允许兼任"],
                  ]
                )}
                ${this.deleteButton("supervisor", rule.id)}
              </div>`
          )}
        </div>
      </div>
    </details>`;
  }

  private transitionRules() {
    const items = this.model.settings.positionTransitionPolicies;
    if (
      !matchesPolicySearch(
        this.query,
        "岗位衔接间隔规则",
        "新增衔接规则",
        "规则名称",
        "启用规则",
        "前序航班",
        "前序晚撤岗位",
        "目标航班",
        "目标岗位",
        "最小间隔（分钟）",
        "执行强度",
        "优先避开",
        "严格限制",
        items.map((item) => [
          item.name,
          item.sourceFlightNo,
          item.sourcePositions,
          item.targetFlightNo,
          item.targetPosition,
          item.minimumGapMinutes,
        ])
      )
    ) {
      return nothing;
    }
    return html`<details
      class="policy-rule-card"
      ?open=${Boolean(normalizePolicySearchQuery(this.query))}
    >
      <summary>
        <span
          ><strong>岗位衔接间隔规则</strong
          ><small
            >${items.filter((item) => item.enabled).length} 条启用</small
          ></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      <div class="policy-rule-content">
        <div class="d-flex justify-content-end mb-2">
          ${this.addButton("transition", "新增衔接规则")}
        </div>
        <div class="policy-card-list">
          ${items.map(
            (rule) =>
              html`<article
                class="transition-policy-grid border-bottom pb-3 mb-3"
              >
                ${this.field("transition-policy", rule.id, "name", rule.name, "规则名称")}
                ${this.toggle("transition-policy", rule.id, "enabled", rule.enabled, "启用规则")}
                ${this.field("transition-policy", rule.id, "sourceFlightNo", rule.sourceFlightNo, "前序航班")}
                ${this.field("transition-policy", rule.id, "sourcePositions", rule.sourcePositions.join(", "), "前序晚撤岗位")}
                ${this.field("transition-policy", rule.id, "targetFlightNo", rule.targetFlightNo, "目标航班")}
                ${this.field("transition-policy", rule.id, "targetPosition", rule.targetPosition, "目标岗位")}
                ${this.field("transition-policy", rule.id, "minimumGapMinutes", rule.minimumGapMinutes, "最小间隔（分钟）", "", "number")}
                ${this.select(
                  "transition-policy",
                  rule.id,
                  "mode",
                  rule.mode,
                  "执行强度",
                  [
                    ["prefer", "优先避开"],
                    ["forbid", "严格限制"],
                  ]
                )}
                <div>${this.deleteButton("transition", rule.id)}</div>
              </article>`
          )}
        </div>
      </div>
    </details>`;
  }

  private field(
    entity: string,
    id: string,
    field: string,
    value: string | number,
    label: string,
    placeholder = "",
    type = "text"
  ) {
    return html`<label class="form-label"
      >${label}<input
        class="form-control form-control-sm"
        type=${type}
        placeholder=${placeholder}
        .value=${String(value)}
        @change=${(event: Event) => dispatchUiCommand(this, { type: "update-policy", entity, id, field, value: inputValue(event.currentTarget as HTMLInputElement) })}
    /></label>`;
  }

  private select(
    entity: string,
    id: string,
    field: string,
    value: string,
    label: string,
    choices: readonly (readonly [string, string])[]
  ) {
    return html`<label class="form-label"
      >${label}<select
        class="form-select form-select-sm"
        .value=${value}
        @change=${(event: Event) => dispatchUiCommand(this, { type: "update-policy", entity, id, field, value: (event.currentTarget as HTMLSelectElement).value })}
      >
        ${choices.map(([choice, text]) => html`<option .value=${choice}>${text}</option>`)}
      </select></label
    >`;
  }

  private toggle(
    entity: string,
    id: string,
    field: string,
    checked: boolean,
    label: string
  ) {
    return html`<label class="form-check form-switch"
      ><input
        class="form-check-input"
        type="checkbox"
        .checked=${checked}
        @change=${(event: Event) => dispatchUiCommand(this, { type: "update-policy", entity, id, field, value: (event.currentTarget as HTMLInputElement).checked })}
      /><span class="form-check-label">${label}</span></label
    >`;
  }

  private addButton(collection: Collection, label: string) {
    return html`<button
      class="btn btn-sm btn-outline-secondary"
      type="button"
      @click=${() => dispatchUiCommand(this, { type: "add-policy-item", collection })}
    >
      <i class="bi bi-plus-lg me-1"></i>${label}
    </button>`;
  }

  private deleteButton(collection: Collection, id: string) {
    return html`<button
      class="btn btn-sm icon-btn text-danger"
      type="button"
      title="删除"
      aria-label="删除"
      @click=${() => dispatchUiCommand(this, { type: "delete-policy-item", collection, id })}
    >
      <i class="bi bi-trash3"></i>
    </button>`;
  }

  private moveDuty(id: string, direction: -1 | 1, disabled: boolean) {
    return html`<button
      class="btn btn-sm icon-btn"
      type="button"
      title=${direction < 0 ? "提高优先级" : "降低优先级"}
      ?disabled=${disabled}
      @click=${() => dispatchUiCommand(this, { type: "move-duty-priority", id, direction })}
    >
      <i class="bi bi-arrow-${direction < 0 ? "up" : "down"}"></i>
    </button>`;
  }

  private moveReservation(id: string, direction: -1 | 1, disabled: boolean) {
    return html`<button
      class="btn btn-sm icon-btn"
      type="button"
      title=${direction < 0 ? "提高优先级" : "降低优先级"}
      ?disabled=${disabled}
      @click=${() =>
        dispatchUiCommand(this, {
          type: "move-cross-workday-reservation",
          id,
          direction,
        })}
    >
      <i class="bi bi-arrow-${direction < 0 ? "up" : "down"}"></i>
    </button>`;
  }
}

customElements.define(
  "autoschedule-policy-structured-rules",
  PolicyStructuredRulesElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-policy-structured-rules": PolicyStructuredRulesElement;
  }
}
