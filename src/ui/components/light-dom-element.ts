import { LitElement } from "lit";

export abstract class LightDomElement extends LitElement {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }
}
