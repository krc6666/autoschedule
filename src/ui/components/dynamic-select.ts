import { ref } from "lit/directives/ref.js";

export function dynamicSelectValue(value: string) {
  return ref((element) => {
    if (!(element instanceof HTMLSelectElement)) return;
    queueMicrotask(() => {
      if (element.isConnected && element.value !== value) element.value = value;
    });
  });
}
