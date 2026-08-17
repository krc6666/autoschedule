// @vitest-environment happy-dom

import Toast from "bootstrap/js/dist/toast";
import { describe, expect, it } from "vitest";

import "../../src/ui/components/app-toast";
import { mountElement } from "./lit-test-helpers";

interface ToastInstance {
  _config: {
    autohide: boolean;
    delay: number;
  };
}

describe("application toast", () => {
  it("keeps danger errors visible until the close button is used", async () => {
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-toast", {
      toast: { id: 1, message: "生成失败", tone: "danger" },
    });

    const toast = element.querySelector<HTMLElement>(".toast")!;
    const instance = Toast.getInstance(toast) as unknown as ToastInstance;

    expect(instance._config.autohide).toBe(false);
    expect(element.querySelector('button[aria-label="关闭"]')).not.toBeNull();
  });

  it("keeps success notifications on the existing timed dismissal", async () => {
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-toast", {
      toast: { id: 2, message: "生成成功", tone: "success" },
    });

    const toast = element.querySelector<HTMLElement>(".toast")!;
    const instance = Toast.getInstance(toast) as unknown as ToastInstance;

    expect(instance._config.autohide).toBe(true);
    expect(instance._config.delay).toBe(3600);
  });
});
