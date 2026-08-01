import { html } from "lit";

import {
  BUILT_IN_SCHEDULING_HOOKS,
  builtInRulePreferences,
  isReorderableRuleHook,
} from "../../domain/rules/built-in-rule-registry";
import type { AppState } from "../../model";
import type { SchedulingRuleId } from "../../domain/rules/schedule-rule-contract";
import { dispatchUiCommand } from "../events/ui-command";
import {
  userRulePresentation,
  userRuleStagePresentation,
} from "../projections/policy-rule-presentation";
import { LightDomElement } from "./light-dom-element";

export class PolicyHookRegistryElement extends LightDomElement {
  static override properties = { model: { attribute: false } };
  model!: AppState;

  protected override render() {
    const preferences = builtInRulePreferences(this.model.settings);
    const preferenceById = new Map(preferences.map((item) => [item.id, item]));
    return html`<details class="policy-rule-card" open>
        <summary>
          <span
            ><strong>规则启用与优先顺序</strong
            ><small>可调整规则默认开启，必须遵守的规则始终生效</small></span
          ><i class="bi bi-chevron-down"></i>
        </summary>
        <div class="policy-rule-content">
          <div class="table-responsive">
            <table class="table align-middle data-table hook-registry-table">
              <thead>
                <tr>
                  <th>顺序</th>
                  <th>处理环节</th>
                  <th>规则</th>
                  <th>状态</th>
                  <th class="action-col">调整</th>
                </tr>
              </thead>
              <tbody>
                ${[...BUILT_IN_SCHEDULING_HOOKS]
                  .sort(
                    (left, right) =>
                      (preferenceById.get(left.id)?.order ?? 0) -
                      (preferenceById.get(right.id)?.order ?? 0)
                  )
                  .map((hook, index) => {
                    const preference = preferenceById.get(hook.id)!;
                    const locked = !hook.configurable;
                    const presentation = userRulePresentation(
                      hook.id as SchedulingRuleId
                    );
                    return html`<tr>
                      <td>${index + 1}</td>
                      <td>
                        <span class="policy-stage-label"
                          >${presentation.stage.label}</span
                        >
                      </td>
                      <td>
                        <strong>${presentation.label}</strong
                        ><small class="d-block text-secondary"
                          >${presentation.description}</small
                        >
                      </td>
                      <td>
                        <label class="form-check form-switch m-0"
                          ><input
                            class="form-check-input"
                            type="checkbox"
                            .checked=${preference.enabled}
                            ?disabled=${locked}
                            title=${locked ? "此规则必须执行" : `启用或停用${presentation.label}`}
                            aria-label=${`启用或停用${presentation.label}`}
                            @change=${(event: Event) => dispatchUiCommand(this, { type: "set-hook-enabled", id: hook.id, enabled: (event.currentTarget as HTMLInputElement).checked })}
                          /><span class="visually-hidden"
                            >${preference.enabled ? "已启用" : "已停用"}</span
                          ></label
                        >
                      </td>
                      <td>
                        ${
                          isReorderableRuleHook(hook.id)
                            ? html`<div class="d-flex gap-1">
                                <button
                                  class="btn btn-sm icon-btn"
                                  type="button"
                                  title="提高优先顺序"
                                  aria-label=${`提高${presentation.label}的优先顺序`}
                                  @click=${() => dispatchUiCommand(this, { type: "move-hook", id: hook.id, direction: -1 })}
                                >
                                  <i class="bi bi-arrow-up"></i></button
                                ><button
                                  class="btn btn-sm icon-btn"
                                  type="button"
                                  title="降低优先顺序"
                                  aria-label=${`降低${presentation.label}的优先顺序`}
                                  @click=${() => dispatchUiCommand(this, { type: "move-hook", id: hook.id, direction: 1 })}
                                >
                                  <i class="bi bi-arrow-down"></i>
                                </button>
                              </div>`
                            : html`<span class="text-secondary">始终执行</span>`
                        }
                      </td>
                    </tr>`;
                  })}
              </tbody>
            </table>
          </div>
          <small class="text-secondary"
            >修改启用状态或优先顺序后，重新排班时生效；当前班表不会被静默改动。</small
          >
        </div>
      </details>
      ${this.plugins()}`;
  }

  private plugins() {
    return html`<details class="policy-rule-card">
      <summary>
        <span
          ><strong>扩展规则文件</strong
          ><small>按需加载本地规则，加载失败不会影响现有班表</small></span
        ><i class="bi bi-chevron-down"></i>
      </summary>
      <div class="policy-rule-content">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <span class="text-secondary small"
            >刷新页面后需要重新选择本地规则文件。</span
          ><label class="btn btn-outline-primary btn-sm mb-0"
            ><i class="bi bi-upload me-1"></i>加载规则文件<input
              class="visually-hidden"
              type="file"
              accept=".js,application/javascript"
              @change=${this.loadPlugin}
          /></label>
        </div>
        ${
          this.model.pluginConfigurations.length
            ? this.model.pluginConfigurations.map(
                (plugin) =>
                  html`<article class="plugin-row border rounded p-3 mb-2">
                    <div
                      class="d-flex justify-content-between align-items-start gap-2"
                    >
                      <div>
                        <strong>${plugin.name}</strong
                        ><small class="d-block text-secondary"
                          >${plugin.fileName} ·
                          ${plugin.status === "loaded" ? "已加载" : "刷新后需要重新选择"}</small
                        >
                      </div>
                      <div class="d-flex gap-1">
                        <label class="form-check form-switch m-0"
                          ><input
                            class="form-check-input"
                            type="checkbox"
                            .checked=${plugin.enabled}
                            ?disabled=${plugin.status !== "loaded"}
                            @change=${(event: Event) => dispatchUiCommand(this, { type: "set-plugin-enabled", id: plugin.id, enabled: (event.currentTarget as HTMLInputElement).checked })}
                          /><span class="visually-hidden"
                            >启用扩展规则</span
                          ></label
                        ><button
                          class="btn btn-sm icon-btn text-danger"
                          type="button"
                          title="移除扩展规则"
                          aria-label="移除扩展规则"
                          @click=${() => dispatchUiCommand(this, { type: "remove-plugin", id: plugin.id })}
                        >
                          <i class="bi bi-trash3"></i>
                        </button>
                      </div>
                    </div>
                    <div class="plugin-rule-list mt-2">
                      ${plugin.rules.map(
                        (rule, index) =>
                          html`<div
                            class="d-flex align-items-center justify-content-between gap-2 py-1"
                          >
                            <label class="form-check m-0"
                              ><input
                                class="form-check-input"
                                type="checkbox"
                                .checked=${rule.enabled}
                                ?disabled=${!plugin.enabled || plugin.status !== "loaded"}
                                @change=${(event: Event) => dispatchUiCommand(this, { type: "set-plugin-rule-enabled", pluginId: plugin.id, ruleId: rule.id, enabled: (event.currentTarget as HTMLInputElement).checked })}
                              /><span class="form-check-label"
                                >${rule.label}<small
                                  class="d-block text-secondary"
                                  >${userRuleStagePresentation(rule.stage).label}</small
                                ></span
                              ></label
                            >
                            <div>
                              ${this.pluginMove(plugin.id, rule.id, -1, index === 0)}${this.pluginMove(plugin.id, rule.id, 1, index === plugin.rules.length - 1)}
                            </div>
                          </div>`
                      )}
                    </div>
                  </article>`
              )
            : html`<div class="empty-state">尚未加载扩展规则</div>`
        }
      </div>
    </details>`;
  }

  private pluginMove(
    pluginId: string,
    ruleId: string,
    direction: -1 | 1,
    disabled: boolean
  ) {
    return html`<button
      class="btn btn-sm icon-btn"
      type="button"
      title=${direction < 0 ? "提高优先顺序" : "降低优先顺序"}
      aria-label=${direction < 0 ? "提高扩展规则的优先顺序" : "降低扩展规则的优先顺序"}
      ?disabled=${disabled}
      @click=${() => dispatchUiCommand(this, { type: "move-plugin-rule", pluginId, ruleId, direction })}
    >
      <i class="bi bi-arrow-${direction < 0 ? "up" : "down"}"></i>
    </button>`;
  }

  private loadPlugin(event: Event): void {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) dispatchUiCommand(this, { type: "load-plugin", file });
  }
}

customElements.define(
  "autoschedule-policy-hook-registry",
  PolicyHookRegistryElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-policy-hook-registry": PolicyHookRegistryElement;
  }
}
