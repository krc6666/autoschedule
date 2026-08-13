import { html, nothing } from "lit";

import type { SchedulePolicyInput } from "../../app/policy-actions";
import type { AppState } from "../../model";
import { dispatchUiCommand } from "../events/ui-command";
import { matchesPolicySearch } from "../projections/policy-search";
import { LightDomElement } from "./light-dom-element";
import { latePriorityFlightScopeCandidates } from "../../domain/statistics/late-priority-flight-scope";

const POLICY_FIELDS: readonly (keyof SchedulePolicyInput)[] = [
  "minimumRegularTransitionMinutes",
  "highLoadProtectionEnabled",
  "highLoadFatigueThreshold",
  "highLoadRecoveryMinutes",
  "remarkedPositionHighLoad",
  "rollingLoadProtectionEnabled",
  "rollingLoadWindowMinutes",
  "rollingLoadMaxFatigue",
  "positionRotationEnabled",
  "latePriorityFlightNumbers",
  "lateShiftRecoveryEnabled",
  "lateShiftEndTime",
  "teamLeaderConcurrentSupervisionMaxOverlapMinutes",
  "workloadBalanceEnabled",
  "maxWorkHoursDifference",
  "maxTodayFatigueDifference",
  "dutyFatiguePoints",
  "earlyDepartureCutoffTime",
  "afternoonRestStartTime",
  "afternoonRestEndTime",
];

const POLICY_SETTING_SEARCH_TEXT = [
  "核心保护与公平参数",
  "保存后当前班表会标记为需要重新生成",
  "普通岗位最小衔接间隔（分钟）",
  "高负荷岗位恢复",
  "优先避开恢复期内人员",
  "高负荷疲劳阈值",
  "恢复时间（分钟）",
  "备注岗位视为高负荷",
  "一号、申报、控制等备注参与判定",
  "滚动负荷保护",
  "限制短时间连续高疲劳",
  "滚动窗口（分钟）",
  "滚动疲劳上限",
  "重点岗位频率与轮岗",
  "重点岗位优先，普通岗位防止连续第三班",
  "末班重点岗位航班范围",
  "勾选后参与四类合计轮换、差值控制和统计",
  "全选",
  "清空",
  "跨工作日恢复保护",
  "全局开放链优先避免连续晚间重岗位",
  "末班结束界线（晚于）",
  "分队长并行督导最大重叠",
  "工时与疲劳均衡",
  "压力不宽松时启用",
  "最大工时差",
  "最大当日疲劳差",
  "值班疲劳点",
  "提前下班截载节点",
  "下午统计开始",
  "下午统计结束",
  "保存规则",
] as const;

function policyInput(model: AppState): SchedulePolicyInput {
  return Object.fromEntries(
    POLICY_FIELDS.map((field) => [field, model.settings[field]])
  ) as unknown as SchedulePolicyInput;
}

export class PolicySettingsFormElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    query: { type: String },
  };
  model!: AppState;
  query = "";
  private sourceModel?: AppState;
  private draft!: SchedulePolicyInput;

  protected override render() {
    if (this.sourceModel !== this.model) {
      this.sourceModel = this.model;
      this.draft = policyInput(this.model);
    }
    if (
      !matchesPolicySearch(
        this.query,
        POLICY_SETTING_SEARCH_TEXT,
        Object.values(this.draft),
        latePriorityFlightScopeCandidates(this.model.positionRules)
      )
    ) {
      return nothing;
    }
    return html`
      <details class="policy-rule-card" open>
        <summary>
          <span
            ><strong>核心保护与公平参数</strong
            ><small>保存后当前班表会标记为需要重新生成</small></span
          ><i class="bi bi-chevron-down"></i>
        </summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            ${this.number("minimumRegularTransitionMinutes", "普通岗位最小衔接间隔（分钟）", 0, 1440, 1)}
            ${this.toggle("highLoadProtectionEnabled", "高负荷岗位恢复", "优先避开恢复期内人员")}
            ${this.number("highLoadFatigueThreshold", "高负荷疲劳阈值", 0.5, 50, 0.5)}
            ${this.number("highLoadRecoveryMinutes", "恢复时间（分钟）", 0, 1440, 30)}
            ${this.toggle("remarkedPositionHighLoad", "备注岗位视为高负荷", "一号、申报、控制等备注参与判定")}
            ${this.toggle("rollingLoadProtectionEnabled", "滚动负荷保护", "限制短时间连续高疲劳")}
            ${this.number("rollingLoadWindowMinutes", "滚动窗口（分钟）", 0, 1440, 30)}
            ${this.number("rollingLoadMaxFatigue", "滚动疲劳上限", 0.5, 100, 0.5)}
            ${this.toggle("positionRotationEnabled", "重点岗位频率与轮岗", "重点岗位优先，普通岗位防止连续第三班")}
            ${this.latePriorityFlightScope()}
            ${this.toggle("lateShiftRecoveryEnabled", "跨工作日恢复保护", "全局开放链优先避免连续晚间重岗位")}
            ${this.time("lateShiftEndTime", "末班结束界线（晚于）")}
            ${this.number("teamLeaderConcurrentSupervisionMaxOverlapMinutes", "分队长并行督导最大重叠", 0, 720, 5)}
            ${this.toggle("workloadBalanceEnabled", "工时与疲劳均衡", "压力不宽松时启用")}
            ${this.number("maxWorkHoursDifference", "最大工时差", 0, 24, 0.5)}
            ${this.number("maxTodayFatigueDifference", "最大当日疲劳差", 0, 100, 0.5)}
            ${this.number("dutyFatiguePoints", "值班疲劳点", 0, 100, 0.5)}
            ${this.time("earlyDepartureCutoffTime", "提前下班截载节点")}
            ${this.time("afternoonRestStartTime", "下午统计开始")}
            ${this.time("afternoonRestEndTime", "下午统计结束")}
          </div>
          <div class="d-flex justify-content-end mt-3">
            <button class="btn btn-primary" type="button" @click=${this.save}>
              <i class="bi bi-check2-circle me-2"></i>保存规则
            </button>
          </div>
        </div>
      </details>
    `;
  }

  private updateDraft<K extends keyof SchedulePolicyInput>(
    field: K,
    value: SchedulePolicyInput[K]
  ): void {
    this.draft = { ...this.draft, [field]: value };
    this.requestUpdate();
  }

  private toggle(
    field: keyof SchedulePolicyInput,
    label: string,
    note: string
  ) {
    return html`<label class="policy-switch"
      ><span><strong>${label}</strong><small>${note}</small></span
      ><span class="form-check form-switch m-0"
        ><input
          class="form-check-input"
          type="checkbox"
          .checked=${Boolean(this.draft[field])}
          @change=${(event: Event) => this.updateDraft(field, (event.currentTarget as HTMLInputElement).checked as never)} /></span
    ></label>`;
  }

  private number(
    field: keyof SchedulePolicyInput,
    label: string,
    min: number,
    max: number,
    step: number
  ) {
    return html`<label class="form-label"
      >${label}<input
        class="form-control"
        type="number"
        min=${min}
        max=${max}
        step=${step}
        .value=${String(this.draft[field])}
        @input=${(event: Event) => this.updateDraft(field, Number((event.currentTarget as HTMLInputElement).value) as never)}
    /></label>`;
  }

  private time(field: keyof SchedulePolicyInput, label: string) {
    return html`<label class="form-label"
      >${label}<input
        class="form-control"
        type="time"
        .value=${String(this.draft[field])}
        @input=${(event: Event) => this.updateDraft(field, (event.currentTarget as HTMLInputElement).value as never)}
    /></label>`;
  }

  private latePriorityFlightScope() {
    const candidates = latePriorityFlightScopeCandidates(
      this.model.positionRules
    );
    const selected = new Set(this.draft.latePriorityFlightNumbers);
    const setScope = (flightNumbers: string[]): void =>
      this.updateDraft("latePriorityFlightNumbers", flightNumbers);
    return html`<fieldset class="late-priority-flight-scope">
      <legend>
        <span
          ><strong>末班重点岗位航班范围</strong
          ><small
            >勾选后参与末班岗位轮换、统计及上一班末班人员晚班轻岗保护</small
          ></span
        >
        <span class="btn-group btn-group-sm" role="group">
          <button
            class="btn btn-outline-secondary"
            type="button"
            @click=${() => setScope(candidates)}
          >
            <i class="bi bi-check2-square me-1"></i>全选
          </button>
          <button
            class="btn btn-outline-secondary"
            type="button"
            @click=${() => setScope([])}
          >
            <i class="bi bi-x-square me-1"></i>清空
          </button>
        </span>
      </legend>
      <div>
        ${
          candidates.length
            ? candidates.map(
                (flightNo) =>
                  html`<label class="form-check">
                    <input
                      class="form-check-input"
                      type="checkbox"
                      .checked=${selected.has(flightNo)}
                      @change=${(event: Event) => {
                        const checked = (
                          event.currentTarget as HTMLInputElement
                        ).checked;
                        setScope(
                          candidates.filter((candidate) =>
                            candidate === flightNo
                              ? checked
                              : selected.has(candidate)
                          )
                        );
                      }}
                    />
                    <span class="form-check-label">${flightNo}</span>
                  </label>`
              )
            : html`<small class="text-body-secondary"
                >当前岗位配置中没有督导、一号、申报或送资料航班</small
              >`
        }
      </div>
    </fieldset>`;
  }

  private save(): void {
    dispatchUiCommand(this, { type: "apply-policy", input: this.draft });
  }
}

customElements.define(
  "autoschedule-policy-settings",
  PolicySettingsFormElement
);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-policy-settings": PolicySettingsFormElement;
  }
}
