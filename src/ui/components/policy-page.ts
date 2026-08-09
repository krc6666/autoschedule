import { html } from "lit";

import type { AppState } from "../../model";
import { LightDomElement } from "./light-dom-element";
import "./policy-rule-ledger";
import "./policy-settings-form";
import "./policy-structured-rules";

export class PolicyPageElement extends LightDomElement {
  static override properties = {
    model: { attribute: false },
    query: { type: String },
  };
  model!: AppState;
  query = "";

  protected override render() {
    return html`<section class="workspace-section policy-workspace">
      <div class="section-heading">
        <div>
          <h3>排班规则</h3>
          <span>按实际排班顺序查看和调整，必须遵守的规则始终生效</span>
        </div>
        <div class="policy-search">
          <i class="bi bi-search"></i
          ><input
            class="form-control form-control-sm"
            type="search"
            placeholder="搜索规则名称、说明、参数或配置内容"
            .value=${this.query}
            @input=${(event: Event) => {
              this.query = (event.currentTarget as HTMLInputElement).value;
              this.requestUpdate();
            }}
          />
        </div>
      </div>
      <autoschedule-policy-settings
        .model=${this.model}
        .query=${this.query}
      ></autoschedule-policy-settings>
      <autoschedule-policy-structured-rules
        .model=${this.model}
        .query=${this.query}
      ></autoschedule-policy-structured-rules>
      <autoschedule-policy-rule-ledger
        .model=${this.model}
        .query=${this.query}
      ></autoschedule-policy-rule-ledger>
    </section>`;
  }
}

customElements.define("autoschedule-policy-page", PolicyPageElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-policy-page": PolicyPageElement;
  }
}
