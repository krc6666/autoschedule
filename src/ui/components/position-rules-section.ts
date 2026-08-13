import { html } from "lit";

import type { AppState, PositionRule } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { configurationInput, configurationSelect } from "./configuration-field";
import { LightDomElement } from "./light-dom-element";
import { dynamicSelectValue } from "./dynamic-select";

const POSITION_CATEGORIES = [
  "常规",
  "引导",
  "机动督导",
  "分流",
  "行政支援",
] as const;

export class PositionRulesSectionElement extends LightDomElement {
  static override properties = { model: { attribute: false } };
  model!: AppState;
  private selectedFlight = "";
  private batchCount = 5;

  protected override render() {
    const flightNumbers = [
      ...new Set(
        [
          ...this.model.templates.map((item) => item.flightNo),
          ...this.model.flights.map((item) => item.flightNo),
          ...this.model.positionRules.map((item) => item.flightNo),
        ].filter(Boolean)
      ),
    ].sort((left, right) => left.localeCompare(right));
    if (!flightNumbers.includes(this.selectedFlight))
      this.selectedFlight = flightNumbers[0] ?? "";
    const groups = flightNumbers
      .map((flightNo) => ({
        flightNo,
        rules: this.model.positionRules.filter(
          (rule) => rule.flightNo === flightNo
        ),
      }))
      .filter((group) => group.rules.length);

    return html`<section class="workspace-section">
      <div class="section-heading">
        <div>
          <h3>岗位规则</h3>
          <span>${this.model.positionRules.length} 条规则 · 按航班折叠</span>
        </div>
        <div class="position-batch-controls">
          <select
            ${dynamicSelectValue(this.selectedFlight)}
            class="form-select form-select-sm"
            aria-label="新增规则所属航班"
            .value=${this.selectedFlight}
            @change=${(event: Event) => {
              this.selectedFlight = (
                event.currentTarget as HTMLSelectElement
              ).value;
            }}
          >
            ${flightNumbers.map(
              (flightNo) =>
                html`<option .value=${flightNo}>${flightNo}</option>`
            )}
          </select>
          <input
            class="form-control form-control-sm"
            type="number"
            min="1"
            max="30"
            .value=${String(this.batchCount)}
            aria-label="新增规则数量"
            @input=${(event: Event) => {
              this.batchCount = Number(
                (event.currentTarget as HTMLInputElement).value
              );
            }}
          />
          <button
            class="btn btn-primary btn-sm"
            type="button"
            @click=${() => dispatchUiCommand(this, { type: "add-positions", flightNo: this.selectedFlight, count: this.batchCount })}
          >
            <i class="bi bi-plus-lg me-1"></i>批量新增
          </button>
        </div>
      </div>
      <div class="position-rule-groups">
        ${
          groups.length
            ? groups.map((group) => this.group(group.flightNo, group.rules))
            : html`<div class="empty-state">尚无岗位规则</div>`
        }
      </div>
    </section>`;
  }

  private group(flightNo: string, rules: PositionRule[]) {
    const count = (category: PositionRule["category"]) =>
      rules.filter((rule) => rule.category === category).length;
    return html`<details class="position-rule-group">
      <summary>
        <strong>${flightNo}</strong
        ><span>
          ${count("常规")} 常规 · ${count("引导")} 引导 · ${count("机动督导")}
          机动督导 · ${count("分流")} 分流 · ${count("行政支援")} 行政支援 </span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      <div class="position-group-toolbar">
        <button
          class="btn btn-sm btn-outline-secondary"
          type="button"
          @click=${() => dispatchUiCommand(this, { type: "sort-counters", flightNo })}
        >
          <i class="bi bi-sort-numeric-down-alt me-1"></i>柜台从大到小
        </button>
      </div>
      <div class="table-responsive">
        <table class="table align-middle data-table position-rule-table">
          <thead>
            <tr>
              <th>顺序</th>
              <th>航班</th>
              <th>岗位</th>
              <th>分类</th>
              <th>疲劳点</th>
              <th>启用旅客人数</th>
              <th>提前撤岗</th>
              <th>资质人员</th>
              <th>备注</th>
              <th class="action-col">
                <span class="visually-hidden">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${rules.map((rule, index) => this.ruleRow(rule, index, rules.length))}
          </tbody>
        </table>
      </div>
    </details>`;
  }

  private ruleRow(rule: PositionRule, index: number, count: number) {
    const names = rule.qualifiedStaffIds.map(
      (id) =>
        this.model.staff.find((person) => person.id === id)?.name ?? `#${id}`
    );
    const qualification =
      rule.category === "引导"
        ? html`<span class="guide-source-label"
            ><i class="bi bi-arrow-down"></i>同航班最下方常规岗位人员</span
          >`
        : html`<button
            class="qualified-button"
            type="button"
            @click=${() => dispatchUiCommand(this, { type: "open-qualification", id: rule.id })}
          >
            <span
              >${rule.manual ? "手动补位" : names.join("、") || "未配置"}</span
            ><i class="bi bi-chevron-right"></i>
          </button>`;
    return html`<tr>
      <td>
        <div class="position-order-controls">
          ${this.moveButton(rule.id, -1, index === 0)}
          ${this.moveButton(rule.id, 1, index === count - 1)}
        </div>
      </td>
      <td>
        ${configurationInput(this, "position", rule.id, "flightNo", rule.flightNo, "航班号", { className: "code-input" })}
      </td>
      <td>
        ${configurationInput(this, "position", rule.id, "name", rule.name, "岗位名称")}
      </td>
      <td>
        ${configurationSelect(this, "position", rule.id, "category", rule.category, "分类", POSITION_CATEGORIES)}
      </td>
      <td>
        ${configurationInput(this, "position", rule.id, "fatiguePoints", rule.fatiguePoints, "疲劳点数", { type: "number", className: "number-input", min: 0, step: 0.5 })}
      </td>
      <td>
        ${configurationInput(this, "position", rule.id, "minPassengers", rule.minPassengers ?? 0, "启用旅客人数", { type: "number", className: "number-input", min: 0, step: 1 })}
      </td>
      <td>
        ${configurationInput(this, "position", rule.id, "earlyReleaseMinutes", rule.earlyReleaseMinutes ?? 0, "提前撤岗分钟", { type: "number", className: "number-input", min: 0, max: 180, step: 5, disabled: rule.category !== "分流" })}
      </td>
      <td>${qualification}</td>
      <td>
        ${configurationInput(this, "position", rule.id, "remark", rule.remark, "备注")}
      </td>
      <td>
        <button
          class="btn btn-sm btn-outline-danger icon-btn"
          type="button"
          title="删除规则"
          aria-label="删除规则"
          @click=${() => dispatchUiCommand(this, { type: "delete-position", id: rule.id })}
        >
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    </tr>`;
  }

  private moveButton(id: string, direction: -1 | 1, disabled: boolean) {
    return html`<button
      class="btn btn-sm btn-light icon-btn"
      type="button"
      title=${direction < 0 ? "上移岗位" : "下移岗位"}
      aria-label=${direction < 0 ? "上移岗位" : "下移岗位"}
      ?disabled=${disabled}
      @click=${() => dispatchUiCommand(this, { type: "move-position", id, direction })}
    >
      <i class="bi bi-arrow-${direction < 0 ? "up" : "down"}"></i>
    </button>`;
  }
}

customElements.define(
  "autoschedule-position-rules",
  PositionRulesSectionElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-position-rules": PositionRulesSectionElement;
  }
}
