// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { installGlobalErrorBoundary } from "../../src/infrastructure/global-error-boundary";

afterEach(() => vi.restoreAllMocks());

describe("global error boundary", () => {
  it("keeps the host visible and shows a panel for uncaught errors", () => {
    const host = document.createElement("main");
    document.body.append(host);
    const boundary = installGlobalErrorBoundary(host);
    const error = new Error("render failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    window.dispatchEvent(Object.assign(new Event("error"), { error }));

    const panel = document.querySelector("#autoschedule-global-error");
    expect(host.isConnected).toBe(true);
    expect(panel?.textContent).toContain("页面遇到问题");
    expect(panel?.textContent).toContain("render failed");
    expect(log).toHaveBeenCalledWith("[autoschedule] window.error", error);

    boundary.dispose();
    expect(document.querySelector("#autoschedule-global-error")).toBeNull();
    host.remove();
  });

  it("reports unhandled rejections without swallowing the diagnostic", () => {
    const host = document.createElement("main");
    document.body.append(host);
    const boundary = installGlobalErrorBoundary(host);
    const reason = new Error("lit update failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason })
    );

    expect(
      document.querySelector("#autoschedule-global-error")?.textContent
    ).toContain("lit update failed");
    expect(log).toHaveBeenCalledWith(
      "[autoschedule] unhandledrejection",
      reason
    );

    boundary.dispose();
    host.remove();
  });
});
