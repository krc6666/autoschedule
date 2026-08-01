import Toast from "bootstrap/js/dist/toast";
import { html, type PropertyValues } from "lit";
import { createRef, ref, type Ref } from "lit/directives/ref.js";

import type { ApplicationToast } from "../../app/application-view-state";
import { dispatchUiCommand } from "../events/ui-command";
import { LightDomElement } from "./light-dom-element";

export class AppToastElement extends LightDomElement {
  static override properties = { toast: { attribute: false } };
  toast: ApplicationToast | null = null;
  private readonly toastRef: Ref<HTMLDivElement> = createRef();

  protected override render() {
    const tone = this.toast?.tone ?? "success";
    return html`<div class="toast-container position-fixed bottom-0 end-0 p-3">
      <div
        ${ref(this.toastRef)}
        class="toast align-items-center border-0 text-bg-${tone}"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        @hidden.bs.toast=${this.dismiss}
      >
        <div class="d-flex">
          <div class="toast-body">${this.toast?.message ?? ""}</div>
          <button
            type="button"
            class="btn-close btn-close-white me-2 m-auto"
            data-bs-dismiss="toast"
            aria-label="关闭"
          ></button>
        </div>
      </div>
    </div>`;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("toast") || !this.toast || !this.toastRef.value) return;
    Toast.getOrCreateInstance(this.toastRef.value, { delay: 3600 }).show();
  }

  private dismiss(): void {
    if (this.toast) dispatchUiCommand(this, { type: "dismiss-toast" });
  }
}

customElements.define("autoschedule-app-toast", AppToastElement);

declare global {
  interface HTMLElementTagNameMap {
    "autoschedule-app-toast": AppToastElement;
  }
}
